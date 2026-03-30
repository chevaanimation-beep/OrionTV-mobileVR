import { create } from 'zustand';
import {
  ActiveDownload,
  DownloadedVideo,
  DownloadStatus,
  DownloadResumable,
  generateVideoKey,
  loadAllDownloadsMeta,
  persistEpisodeDownload,
  removeEpisodeFromMeta,
  startEpisodeDownload,
  deleteVideoDownload,
  formatBytes,
  PseudoResumable,
} from '@/services/downloadManager';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('DownloadStore');

export { formatBytes };

interface DownloadStore {
  // Persisted downloaded videos
  downloadedVideos: DownloadedVideo[];
  // Active in-progress downloads (transient, not persisted)
  activeDownloads: Record<string, ActiveDownload>; // key: `${videoKey}:${episodeIndex}`
  // Loading flag for initial meta load
  loading: boolean;

  // --- Actions ---
  loadDownloads: () => Promise<void>;
  startDownload: (
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
  ) => Promise<void>;
  cancelDownload: (videoKey: string, episodeIndex: number) => void;
  deleteVideo: (source: string, id: string) => Promise<void>;
  deleteEpisode: (source: string, id: string, episodeIndex: number) => Promise<void>;
  isEpisodeDownloaded: (source: string, id: string, episodeIndex: number) => boolean;
  isEpisodeDownloading: (source: string, id: string, episodeIndex: number) => boolean;
  getEpisodeDownloadProgress: (source: string, id: string, episodeIndex: number) => number;
  getLocalEpisodePath: (source: string, id: string, episodeIndex: number) => string | null;

  // Internal: cancellation registry
  _resumables: Record<string, DownloadResumable | PseudoResumable | null>;
}

const useDownloadStore = create<DownloadStore>((set, get) => ({
  downloadedVideos: [],
  activeDownloads: {},
  loading: false,
  _resumables: {},

  loadDownloads: async () => {
    set({ loading: true });
    try {
      const meta = await loadAllDownloadsMeta();
      const videos = Object.values(meta).sort((a, b) => b.addedAt - a.addedAt);
      set({ downloadedVideos: videos });
    } catch (e) {
      logger.error('Failed to load downloads:', e);
    } finally {
      set({ loading: false });
    }
  },

  startDownload: async (video, episodeIndex, episodeUrl, episodeLabel) => {
    const videoKey = generateVideoKey(video.source, video.id);
    const dlKey = `${videoKey}:${episodeIndex}`;

    // Prevent duplicate downloads
    const existing = get().activeDownloads[dlKey];
    if (existing && (existing.status === 'downloading' || existing.status === 'pending')) {
      logger.info(`Download already in progress for ${dlKey}`);
      return;
    }

    // Check if already fully downloaded
    if (get().isEpisodeDownloaded(video.source, video.id, episodeIndex)) {
      logger.info(`Episode ${episodeIndex} already downloaded for ${videoKey}`);
      return;
    }

    // Set initial active download state
    set((state) => ({
      activeDownloads: {
        ...state.activeDownloads,
        [dlKey]: {
          videoKey,
          episodeIndex,
          episodeLabel,
          status: 'pending',
          progress: 0,
        },
      },
    }));

    const resumable = await startEpisodeDownload(
      video,
      episodeIndex,
      episodeUrl,
      episodeLabel,
      (progress) => {
        set((state) => ({
          activeDownloads: {
            ...state.activeDownloads,
            [dlKey]: {
              ...state.activeDownloads[dlKey],
              status: 'downloading',
              progress,
            },
          },
        }));
      },
      async (localPath, fileSize) => {
        logger.info(`Download complete: ${dlKey} => ${localPath} (${fileSize} bytes)`);

        // Persist to metadata
        await persistEpisodeDownload(video, episodeIndex, episodeLabel, localPath, fileSize);

        // Refresh downloaded videos list
        await get().loadDownloads();

        // Remove from active downloads
        set((state) => {
          const updated = { ...state.activeDownloads };
          delete updated[dlKey];
          const resumables = { ...state._resumables };
          delete resumables[dlKey];
          return { activeDownloads: updated, _resumables: resumables };
        });
      },
      (error) => {
        logger.error(`Download failed: ${dlKey} - ${error}`);
        set((state) => ({
          activeDownloads: {
            ...state.activeDownloads,
            [dlKey]: {
              ...state.activeDownloads[dlKey],
              status: 'failed',
              error,
            },
          },
        }));
      },
    );

    if (resumable) {
      set((state) => ({
        _resumables: { ...state._resumables, [dlKey]: resumable },
      }));
    }
  },

  cancelDownload: (videoKey, episodeIndex) => {
    const dlKey = `${videoKey}:${episodeIndex}`;
    const resumable = get()._resumables[dlKey];
    if (resumable) {
      resumable.cancelAsync().catch(() => {});
    }
    set((state) => {
      const updated = { ...state.activeDownloads };
      delete updated[dlKey];
      const resumables = { ...state._resumables };
      delete resumables[dlKey];
      return { activeDownloads: updated, _resumables: resumables };
    });
  },

  deleteVideo: async (source, id) => {
    await deleteVideoDownload(source, id);
    await get().loadDownloads();
  },

  deleteEpisode: async (source, id, episodeIndex) => {
    await removeEpisodeFromMeta(source, id, episodeIndex);
    await get().loadDownloads();
  },

  isEpisodeDownloaded: (source, id, episodeIndex) => {
    const key = generateVideoKey(source, id);
    const video = get().downloadedVideos.find((v) => generateVideoKey(v.source, v.id) === key);
    return !!video?.episodes.find((e) => e.episodeIndex === episodeIndex);
  },

  isEpisodeDownloading: (source, id, episodeIndex) => {
    const dlKey = `${generateVideoKey(source, id)}:${episodeIndex}`;
    const dl = get().activeDownloads[dlKey];
    return !!dl && (dl.status === 'downloading' || dl.status === 'pending');
  },

  getEpisodeDownloadProgress: (source, id, episodeIndex) => {
    const dlKey = `${generateVideoKey(source, id)}:${episodeIndex}`;
    return get().activeDownloads[dlKey]?.progress ?? 0;
  },

  getLocalEpisodePath: (source, id, episodeIndex) => {
    const key = generateVideoKey(source, id);
    const video = get().downloadedVideos.find((v) => generateVideoKey(v.source, v.id) === key);
    const episode = video?.episodes.find((e) => e.episodeIndex === episodeIndex);
    return episode?.localPath ?? null;
  },
}));

export default useDownloadStore;
