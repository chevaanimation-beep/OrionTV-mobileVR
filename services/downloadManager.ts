import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  createDownloadResumable,
  DownloadResumable,
  DownloadProgressData,
  writeAsStringAsync,
} from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('DownloadManager');

const DOWNLOADS_DIR = `${documentDirectory}downloads/`;
const DOWNLOADS_META_KEY = 'oriontv_downloads_meta';

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';

export interface DownloadedEpisode {
  episodeIndex: number;
  episodeLabel: string;
  localPath: string;
  fileSize: number; // bytes
  downloadedAt: number; // timestamp
}

export interface DownloadedVideo {
  // Identifiers
  source: string;
  id: string;
  title: string;
  poster: string;
  year: string;
  typeName: string;
  sourceName: string;
  // Episodes
  episodes: DownloadedEpisode[];
  // Meta
  addedAt: number;
  totalSize: number; // bytes across all episodes
}

export interface ActiveDownload {
  videoKey: string; // source+id
  episodeIndex: number;
  episodeLabel: string;
  status: DownloadStatus;
  progress: number; // 0-1
  error?: string;
}

// --- Helpers ---
const generateVideoKey = (source: string, id: string) => `${source}+${id}`;

const ensureDownloadsDir = async () => {
  const dirInfo = await getInfoAsync(DOWNLOADS_DIR);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
  }
};

const getLocalFileOrDirPath = (source: string, id: string, episodeIndex: number, isM3u8: boolean = false) => {
  if (isM3u8) {
    // For M3U8, we return the directory path. The actual playable file is index.m3u8 inside it.
    return `${DOWNLOADS_DIR}${source}_${id}_ep${episodeIndex}/`;
  }
  return `${DOWNLOADS_DIR}${source}_${id}_ep${episodeIndex}.mp4`;
};

const resolveUrl = (base: string, relative: string) => {
  if (relative.startsWith('http')) return relative;
  if (relative.startsWith('/')) {
    const url = new URL(base);
    return `${url.origin}${relative}`;
  }
  const parts = base.split('?')[0].split('/');
  parts.pop();
  return `${parts.join('/')}/${relative}`;
};

// --- Metadata persistence ---
export const loadAllDownloadsMeta = async (): Promise<Record<string, DownloadedVideo>> => {
  try {
    const data = await AsyncStorage.getItem(DOWNLOADS_META_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    logger.error('Failed to load downloads meta:', e);
    return {};
  }
};

export const saveAllDownloadsMeta = async (meta: Record<string, DownloadedVideo>): Promise<void> => {
  try {
    await AsyncStorage.setItem(DOWNLOADS_META_KEY, JSON.stringify(meta));
  } catch (e) {
    logger.error('Failed to save downloads meta:', e);
  }
};

// --- Download functions ---

export interface PseudoResumable {
  cancelAsync: () => Promise<void>;
}

/**
 * Start downloading a video episode.
 * Handles both standard MP4 and HLS M3U8 formats automatically.
 */
export const startEpisodeDownload = async (
  video: {
    source: string;
    id: string;
    title: string;
    poster: string;
    year: string;
    typeName: string;
    sourceName: string;
  },
  episodeIndex: number,
  episodeUrl: string,
  episodeLabel: string,
  onProgress: (progress: number) => void,
  onComplete: (localPath: string, fileSize: number) => void,
  onError: (error: string) => void,
): Promise<DownloadResumable | PseudoResumable | null> => {
  try {
    await ensureDownloadsDir();

    // 1. Initial network check to see if it's M3U8
    const manifestRes = await fetch(episodeUrl);
    if (!manifestRes.ok) throw new Error('Failed to fetch video URL');
    const manifestText = await manifestRes.text();

    const isM3u8 = manifestText.trim().startsWith('#EXTM3U');
    
    if (isM3u8) {
      // ===== M3U8 DOWNLOAD LOGIC =====
      const epDir = getLocalFileOrDirPath(video.source, video.id, episodeIndex, true);
      const localM3u8Path = `${epDir}local.m3u8`;

      // Check if already downloaded
      const existingInfo = await getInfoAsync(localM3u8Path);
      if (existingInfo.exists) {
        onComplete(localM3u8Path, existingInfo.size ?? 0);
        return null;
      }

      await makeDirectoryAsync(epDir, { intermediates: true });

      let mediaManifest = manifestText;
      let baseUrl = episodeUrl;

      // Handle Master Playlist
      if (mediaManifest.includes('#EXT-X-STREAM-INF')) {
        const lines = mediaManifest.split('\n');
        let variantUrl = '';
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            for (let j = i + 1; j < lines.length; j++) {
              if (lines[j].trim() && !lines[j].startsWith('#')) {
                variantUrl = resolveUrl(baseUrl, lines[j].trim());
                break;
              }
            }
            if (variantUrl) break;
          }
        }
        if (variantUrl) {
          baseUrl = variantUrl;
          const varRes = await fetch(baseUrl);
          mediaManifest = await varRes.text();
        }
      }

      // Parse Segments and Keys
      const lines = mediaManifest.split('\n');
      const downloadTasks: { url: string; localName: string }[] = [];
      let localManifestObj = '';
      
      let segIndex = 0;
      let keyIndex = 0;

      for (let line of lines) {
        if (line.trim().length === 0) continue;
        
        if (line.startsWith('#EXT-X-KEY')) {
          const match = line.match(/URI="(.*?)"/);
          if (match && match[1]) {
            const keyUri = match[1];
            if (!keyUri.startsWith('data:')) {
              const keyUrl = resolveUrl(baseUrl, keyUri);
              const localKeyName = `key_${keyIndex++}.key`;
              downloadTasks.push({ url: keyUrl, localName: localKeyName });
              localManifestObj += line.replace(`URI="${keyUri}"`, `URI="${localKeyName}"`) + '\n';
              continue;
            }
          }
          localManifestObj += line + '\n';
        } else if (!line.startsWith('#')) {
          // TS Segment
          const tsUrl = resolveUrl(baseUrl, line.trim());
          const extMatch = tsUrl.split('?')[0].match(/\.([^.]+)$/);
          const ext = extMatch ? extMatch[1] : 'ts';
          const localTsName = `seg_${segIndex++}.${ext}`;
          downloadTasks.push({ url: tsUrl, localName: localTsName });
          localManifestObj += localTsName + '\n';
        } else {
          localManifestObj += line + '\n';
        }
      }

      let cancelled = false;
      let completedFiles = 0;
      const totalFiles = downloadTasks.length;

      const pseudoResumable: PseudoResumable = {
        cancelAsync: async () => { cancelled = true; }
      };

      // Concurrent Downloader
      (async () => {
        try {
          const CONCURRENCY = 5;
          let taskIndex = 0;
          
          const workers = Array.from({ length: CONCURRENCY }, async () => {
            while (taskIndex < downloadTasks.length) {
              if (cancelled) break;
              const task = downloadTasks[taskIndex++];
              const destPath = `${epDir}${task.localName}`;
              
              // Skip if already exists (partial resume support)
              const existing = await getInfoAsync(destPath);
              if (!existing.exists || (existing as { size: number }).size === 0) {
                try {
                  const dl = createDownloadResumable(task.url, destPath);
                  await dl.downloadAsync();
                } catch (e) {
                  logger.error(`Failed to download segment: ${task.url}`, e);
                }
              }
              completedFiles++;
              onProgress(Math.min(completedFiles / totalFiles, 1));
            }
          });

          await Promise.all(workers);

          if (cancelled) {
            // Cleanup on cancel to save space
            await deleteAsync(epDir, { idempotent: true });
            return;
          }

          // Write local m3u8 file
          await writeAsStringAsync(localM3u8Path, localManifestObj);

          // Calculate total space
          let totalSize = 0;
          for (const t of downloadTasks) {
            try {
              const s = await getInfoAsync(`${epDir}${t.localName}`);
              if (s.exists) totalSize += (s as { size: number }).size ?? 0;
            } catch (e) {}
          }

          logger.info(`M3U8 download complete: ${totalFiles} files, ${formatBytes(totalSize)}`);
          onComplete(localM3u8Path, totalSize);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : '下载失败';
          onError(errMsg);
        }
      })();

      return pseudoResumable;

    } else {
      // ===== STANDARD MP4 DOWNLOAD LOGIC =====
      const localPath = getLocalFileOrDirPath(video.source, video.id, episodeIndex, false);

      const existingInfo = await getInfoAsync(localPath);
      if (existingInfo.exists) {
        onComplete(localPath, existingInfo.size ?? 0);
        return null;
      }

      const downloadResumable = createDownloadResumable(
        episodeUrl,
        localPath,
        {},
        (downloadProgress: DownloadProgressData) => {
          const progress = downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
            : 0;
          onProgress(Math.min(progress, 1));
        },
      );

      downloadResumable.downloadAsync().then(async (result) => {
        if (result) {
          const fileInfo = await getInfoAsync(result.uri);
          onComplete(result.uri, (fileInfo as { size: number }).size ?? 0);
        }
      }).catch((e) => {
        onError(e.message);
      });

      return downloadResumable;
    }

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : '解析下载地址失败';
    logger.error(`Start download error for ep${episodeIndex}:`, e);
    onError(errMsg);
    return null;
  }
};

/**
 * Delete a downloaded episode file or M3U8 directory.
 */
export const deleteEpisodeDownload = async (
  source: string,
  id: string,
  episodeIndex: number,
): Promise<void> => {
  try {
    // Try deleting M3U8 directory first
    const dirPath = getLocalFileOrDirPath(source, id, episodeIndex, true);
    const dirInfo = await getInfoAsync(dirPath);
    if (dirInfo.exists) {
      await deleteAsync(dirPath, { idempotent: true });
    }

    // Try deleting standard MP4 file
    const filePath = getLocalFileOrDirPath(source, id, episodeIndex, false);
    const fileInfo = await getInfoAsync(filePath);
    if (fileInfo.exists) {
      await deleteAsync(filePath, { idempotent: true });
    }
  } catch (e) {
    logger.error(`Failed to delete episode:`, e);
  }
};

/**
 * Delete ALL episodes of a video and remove from metadata.
 */
export const deleteVideoDownload = async (source: string, id: string): Promise<void> => {
  const meta = await loadAllDownloadsMeta();
  const key = generateVideoKey(source, id);
  const videoMeta = meta[key];

  if (videoMeta) {
    for (const ep of videoMeta.episodes) {
      await deleteEpisodeDownload(source, id, ep.episodeIndex);
    }
    delete meta[key];
    await saveAllDownloadsMeta(meta);
  }
};

/**
 * Add a completed episode to the persistent metadata store.
 */
export const persistEpisodeDownload = async (
  video: {
    source: string;
    id: string;
    title: string;
    poster: string;
    year: string;
    typeName: string;
    sourceName: string;
  },
  episodeIndex: number,
  episodeLabel: string,
  localPath: string,
  fileSize: number,
): Promise<void> => {
  const meta = await loadAllDownloadsMeta();
  const key = generateVideoKey(video.source, video.id);

  const episode: DownloadedEpisode = {
    episodeIndex,
    episodeLabel,
    localPath,
    fileSize,
    downloadedAt: Date.now(),
  };

  if (meta[key]) {
    const existing = meta[key];
    const epIdx = existing.episodes.findIndex((e) => e.episodeIndex === episodeIndex);
    if (epIdx >= 0) {
      existing.episodes[epIdx] = episode;
    } else {
      existing.episodes.push(episode);
      existing.episodes.sort((a, b) => a.episodeIndex - b.episodeIndex);
    }
    existing.totalSize = existing.episodes.reduce((sum, e) => sum + e.fileSize, 0);
  } else {
    meta[key] = {
      source: video.source,
      id: video.id,
      title: video.title,
      poster: video.poster,
      year: video.year,
      typeName: video.typeName,
      sourceName: video.sourceName,
      episodes: [episode],
      addedAt: Date.now(),
      totalSize: fileSize,
    };
  }

  await saveAllDownloadsMeta(meta);
};

/**
 * Remove a single episode from the persistent metadata and delete its file.
 */
export const removeEpisodeFromMeta = async (
  source: string,
  id: string,
  episodeIndex: number,
): Promise<void> => {
  const meta = await loadAllDownloadsMeta();
  const key = generateVideoKey(source, id);

  if (!meta[key]) return;

  await deleteEpisodeDownload(source, id, episodeIndex);

  meta[key].episodes = meta[key].episodes.filter((e) => e.episodeIndex !== episodeIndex);
  if (meta[key].episodes.length === 0) {
    delete meta[key];
  } else {
    meta[key].totalSize = meta[key].episodes.reduce((sum, e) => sum + e.fileSize, 0);
  }

  await saveAllDownloadsMeta(meta);
};

/**
 * Format bytes to a human-readable string.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export { generateVideoKey, DownloadResumable };
