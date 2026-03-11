import React, { useEffect, useRef, useCallback, memo, useMemo } from "react";
import { StyleSheet, TouchableOpacity, BackHandler, AppState, AppStateStatus, View, Platform, NativeModules } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video, ResizeMode } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('PlayScreen');

// 优化的加载动画组件
const LoadingContainer = memo(
  ({ style, currentEpisode }: { style: any; currentEpisode: { url: string; title: string } | undefined }) => {
    logger.info(
      `[PERF] Video component NOT rendered - waiting for valid URL. currentEpisode: ${!!currentEpisode}, url: ${currentEpisode?.url ? "exists" : "missing"
      }`
    );
    return (
      <View style={style}>
        <VideoLoadingAnimation showProgressBar />
      </View>
    );
  }
);

LoadingContainer.displayName = "LoadingContainer";

// 移到组件外部避免重复创建
const createResponsiveStyles = (deviceType: string) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "black",
      // 移动端和平板端可能需要状态栏处理
      ...(isMobile || isTablet ? { paddingTop: 0 } : {}),
    },
    videoContainer: {
      ...StyleSheet.absoluteFillObject,
      // 为触摸设备添加更多的交互区域
      ...(isMobile || isTablet ? { zIndex: 1 } : {}),
    },
    videoPlayer: {
      ...StyleSheet.absoluteFillObject,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 10,
    },
    // VR SBS mode: two videos side by side
    sbsContainer: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: "row",
    },
    sbsVideoHalf: {
      flex: 1,
      backgroundColor: "black",
    },
    sbsVideoPlayer: {
      flex: 1,
    },
  });
};

export default function PlayScreen() {
  const videoRef = useRef<Video>(null);
  const videoRefRight = useRef<Video>(null);
  const router = useRouter();
  useKeepAwake();

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();
  const isMobile = deviceType === "mobile" || deviceType === "tablet";

  const {
    episodeIndex: episodeIndexStr,
    position: positionStr,
    source: sourceStr,
    id: videoId,
    title: videoTitle,
  } = useLocalSearchParams<{
    episodeIndex: string;
    position?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const episodeIndex = parseInt(episodeIndexStr || "0", 10);
  const position = positionStr ? parseInt(positionStr, 10) : undefined;

  const { detail } = useDetailStore();
  const source = sourceStr || detail?.source;
  const id = videoId || detail?.id.toString();
  const title = videoTitle || detail?.title;
  const {
    isLoading,
    showControls,
    initialPosition,
    introEndTime,
    playbackRate,
    vrSBSMode,
    setVideoRef,
    handlePlaybackStatusUpdate,
    setShowControls,
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
  });

  // TV遥控器处理 - 总是调用hook，但根据设备类型决定是否使用结果
  const tvRemoteHandler = useTVRemoteHandler();

  // 优化的动态样式 - 使用useMemo避免重复计算
  const dynamicStyles = useMemo(() => createResponsiveStyles(deviceType), [deviceType]);

  // ===== 手机端自动横屏 (通过 Android Activity 原生接口实现，无需额外依赖) =====
  useEffect(() => {
    if (isMobile && Platform.OS === "android") {
      try {
        // ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE = 0
        NativeModules.RNScreenOrientation?.lockToLandscape?.();
      } catch {
        // 忽略不支持的设备
      }

      return () => {
        try {
          // 恢复 SCREEN_ORIENTATION_UNSPECIFIED = -1
          NativeModules.RNScreenOrientation?.unlockAllOrientations?.();
        } catch {
          // 忽略
        }
      };
    }
  }, [isMobile]);

  useEffect(() => {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayScreen useEffect START - source: ${source}, id: ${id}, title: ${title}`);

    setVideoRef(videoRef);
    if (source && id && title) {
      logger.info(`[PERF] Calling loadVideo with episodeIndex: ${episodeIndex}, position: ${position}`);
      loadVideo({ source, id, episodeIndex, position, title });
    } else {
      logger.info(`[PERF] Missing required params - source: ${!!source}, id: ${!!id}, title: ${!!title}`);
    }

    const perfEnd = performance.now();
    logger.info(`[PERF] PlayScreen useEffect END - took ${(perfEnd - perfStart).toFixed(2)}ms`);

    return () => {
      logger.info(`[PERF] PlayScreen unmounting - calling reset()`);
      reset(); // Reset state when component unmounts
    };
  }, [episodeIndex, source, position, setVideoRef, reset, loadVideo, id, title]);

  // 优化的屏幕点击处理
  const onScreenPress = useCallback(() => {
    if (deviceType === "tv") {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [deviceType, tvRemoteHandler, setShowControls, showControls]);

  // 自动隐藏控件 (手机端)
  useEffect(() => {
    if (isMobile && showControls) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isMobile, showControls, setShowControls]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        videoRef.current?.pauseAsync();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (showControls) {
        setShowControls(false);
        return true;
      }
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);

    return () => backHandler.remove();
  }, [showControls, setShowControls, router]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isLoading) {
      timeoutId = setTimeout(() => {
        if (usePlayerStore.getState().isLoading) {
          usePlayerStore.setState({ isLoading: false });
          Toast.show({ type: "error", text1: "播放超时，请重试" });
        }
      }, 60000); // 1 minute
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  // ===== VR SBS 同步：右侧视频跟踪左侧播放状态 =====
  useEffect(() => {
    if (!vrSBSMode || !currentEpisode?.url) return;

    // 同步右侧视频的播放状态
    const syncInterval = setInterval(async () => {
      try {
        const leftStatus = await videoRef.current?.getStatusAsync();
        if (leftStatus?.isLoaded && videoRefRight.current) {
          const rightStatus = await videoRefRight.current.getStatusAsync();
          if (rightStatus?.isLoaded) {
            // 同步位置（如果差距超过500ms则同步）
            const posDiff = Math.abs(leftStatus.positionMillis - rightStatus.positionMillis);
            if (posDiff > 500) {
              await videoRefRight.current.setPositionAsync(leftStatus.positionMillis);
            }
            // 同步播放/暂停状态
            if (leftStatus.isPlaying !== rightStatus.isPlaying) {
              if (leftStatus.isPlaying) {
                await videoRefRight.current.playAsync();
              } else {
                await videoRefRight.current.pauseAsync();
              }
            }
          }
        }
      } catch {
        // 忽略同步错误
      }
    }, 1000);

    return () => clearInterval(syncInterval);
  }, [vrSBSMode, currentEpisode?.url]);

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  return (
    <ThemedView focusable style={dynamicStyles.container}>
      {/* 手机端隐藏状态栏 */}
      {isMobile && <StatusBar hidden />}

      <TouchableOpacity
        activeOpacity={1}
        style={dynamicStyles.videoContainer}
        onPress={onScreenPress}
        disabled={isMobile && showControls} // 移动端在显示控制条时禁用触摸
      >
        {/* VR SBS 模式：两个 Video 并排 */}
        {vrSBSMode && currentEpisode?.url ? (
          <View style={dynamicStyles.sbsContainer}>
            <View style={dynamicStyles.sbsVideoHalf}>
              <Video
                ref={videoRef}
                style={dynamicStyles.sbsVideoPlayer}
                source={{ uri: currentEpisode.url }}
                resizeMode={ResizeMode.CONTAIN}
                rate={playbackRate}
                onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                shouldPlay
                useNativeControls={false}
              />
            </View>
            <View style={dynamicStyles.sbsVideoHalf}>
              <Video
                ref={videoRefRight}
                style={dynamicStyles.sbsVideoPlayer}
                source={{ uri: currentEpisode.url }}
                resizeMode={ResizeMode.CONTAIN}
                rate={playbackRate}
                shouldPlay
                useNativeControls={false}
                isMuted
              />
            </View>
          </View>
        ) : currentEpisode?.url ? (
          <Video ref={videoRef} style={dynamicStyles.videoPlayer} {...videoProps} />
        ) : (
          <LoadingContainer style={dynamicStyles.loadingContainer} currentEpisode={currentEpisode} />
        )}

        {/* 显示控制条 - TV 和 Mobile/Tablet 都显示自定义控件 */}
        {showControls && (
          <PlayerControls
            showControls={showControls}
            setShowControls={setShowControls}
            deviceType={deviceType}
          />
        )}

        <SeekingBar />

        {/* 只在Video组件存在且正在加载时显示加载动画覆盖层 */}
        {currentEpisode?.url && isLoading && (
          <View style={dynamicStyles.loadingContainer}>
            <VideoLoadingAnimation showProgressBar />
          </View>
        )}
      </TouchableOpacity>

      <EpisodeSelectionModal />
      <SourceSelectionModal />
      <SpeedSelectionModal />
    </ThemedView>
  );
}
