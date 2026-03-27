import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  createDownloadResumable,
  DownloadResumable,
  DownloadProgressData,
} from 'expo-file-system/legacy';
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

const getLocalFilePath = (source: string, id: string, episodeIndex: number) =>
  `${DOWNLOADS_DIR}${source}_${id}_ep${episodeIndex}.mp4`;

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

/**
 * Start downloading a video episode.
 * Returns the DownloadResumable handle (for cancellation) or null.
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
): Promise<DownloadResumable | null> => {
  try {
    await ensureDownloadsDir();
    const localPath = getLocalFilePath(video.source, video.id, episodeIndex);

    // Check if already downloaded
    const existingInfo = await getInfoAsync(localPath);
    if (existingInfo.exists) {
      const fileSize = (existingInfo as any).size ?? 0;
      onComplete(localPath, fileSize);
      return null;
    }

    const downloadResumable = createDownloadResumable(
      episodeUrl,
      localPath,
      {},
      (downloadProgress: DownloadProgressData) => {
        const progress =
          downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
            : 0;
        onProgress(Math.min(progress, 1));
      },
    );

    const result = await downloadResumable.downloadAsync();
    if (result) {
      const fileInfo = await getInfoAsync(result.uri);
      const fileSize = (fileInfo as any).size ?? 0;
      onComplete(result.uri, fileSize);
    }

    return downloadResumable;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : '下载失败';
    logger.error(`Download error for ep${episodeIndex}:`, e);
    onError(errMsg);
    return null;
  }
};

/**
 * Delete a downloaded episode file.
 */
export const deleteEpisodeDownload = async (
  source: string,
  id: string,
  episodeIndex: number,
): Promise<void> => {
  const localPath = getLocalFilePath(source, id, episodeIndex);
  try {
    const info = await getInfoAsync(localPath);
    if (info.exists) {
      await deleteAsync(localPath, { idempotent: true });
    }
  } catch (e) {
    logger.error(`Failed to delete episode file:`, e);
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
