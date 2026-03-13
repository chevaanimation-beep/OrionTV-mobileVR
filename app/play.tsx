import React, { useEffect, useRef, useCallback, memo, useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, BackHandler, AppState, AppStateStatus, View, Platform, NativeModules, PanResponder, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video, ResizeMode } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { NativeVRPlayer, NativeVRPlayerRef } from "@/components/NativeVRPlayer";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { VRSettingsPanel } from "@/components/VRSettingsPanel";
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
  const vrPlayerRef = useRef<NativeVRPlayerRef>(null);
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
    vrScale,
    vrGap,
    vrDistortionK1,
    vrDistortionK2,
    showVRSettingsModal,
    setShowVRSettingsModal,
    isLocked,
    isRotated,
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

  // 优化的动态样式
  const dynamicStyles = useMemo(() => createResponsiveStyles(deviceType), [deviceType]);

  // ===== 屏幕尺寸（用于旋转变换计算）=====
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [brightnessOverlay, setBrightnessOverlay] = useState<number | null>(null);
  const brightnessTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startBrightness = useRef(0.5);
  // 记录是否正在滑动，防止误触屏幕唤出进度条
  const isSwipingRef = useRef(false);

  const brightnessPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        // 只响应左侧 1/4 屏幕的手势
        return evt.nativeEvent.pageX < screenW * 0.25;
      },
      onMoveShouldSetPanResponder: (evt) => {
        return evt.nativeEvent.pageX < screenW * 0.25;
      },
      onPanResponderGrant: () => {
        isSwipingRef.current = true;
        NativeModules.BrightnessModule?.getBrightness((v: number) => {
          startBrightness.current = v;
        });
      },
      onPanResponderMove: (_, gestureState) => {
        // 只有滑过了哪怕一点距离，才被认为是有效的滑动
        if (Math.abs(gestureState.dy) > 10) {
          isSwipingRef.current = true;
          // 上滑增亮，下滑减暗；滑动整屏高度 = 从 0 到 1
          const delta = -gestureState.dy / screenH;
          const newBrightness = Math.max(0.02, Math.min(1, startBrightness.current + delta));
          NativeModules.BrightnessModule?.setBrightness(newBrightness);
          setBrightnessOverlay(newBrightness);
          if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
          brightnessTimerRef.current = setTimeout(() => setBrightnessOverlay(null), 1500);
        }
      },
      onPanResponderRelease: () => {
        setTimeout(() => { isSwipingRef.current = false; }, 100);
      },
      onPanResponderTerminate: () => {
        setTimeout(() => { isSwipingRef.current = false; }, 100);
      }
    })
  ).current;

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
    if (isSwipingRef.current) return;

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

  // VR SBS 同步不再需要 — 原生 OpenGL 渲染器通过单一解码器实现帧级同步

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  return (
    <ThemedView focusable style={dynamicStyles.container}>
      {/* 手机端隐藏状态栏 */}
      {isMobile && <StatusBar hidden />}

      <TouchableOpacity
        activeOpacity={1}
        style={[
          dynamicStyles.videoContainer,
          // 修复横竖屏 CSS 旋转：使用绝对居中再旋转，可以保证不受父容器 flex bounds 影响而裁剪或错位
          isRotated && {
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: screenH, // width becomes the longer dimension
            height: screenW, // height becomes the shorter dimension
            transform: [
              { translateX: -screenH / 2 },
              { translateY: -screenW / 2 },
              { rotate: '90deg' }
            ],
          }
        ]}
        onPress={onScreenPress}
        disabled={isMobile && showControls}
        {...(isMobile ? brightnessPanResponder.panHandlers : {})}
      >
        {/* VR SBS 模式：使用原生 OpenGL 渲染器（单解码器，帧级同步） */}
        {vrSBSMode && currentEpisode?.url && Platform.OS === "android" ? (
          <NativeVRPlayer
            ref={vrPlayerRef}
            uri={currentEpisode.url}
            rate={playbackRate}
            scale={vrScale}
            gap={vrGap}
            distortionK1={vrDistortionK1}
            distortionK2={vrDistortionK2}
            paused={false}
            style={StyleSheet.absoluteFillObject}
            onVRStatusUpdate={(e) => {
              // 可以将原生播放器的状态同步到 playerStore
            }}
          />
        ) : currentEpisode?.url ? (
          <Video ref={videoRef} style={dynamicStyles.videoPlayer} {...videoProps} />
        ) : (
          <LoadingContainer style={dynamicStyles.loadingContainer} currentEpisode={currentEpisode} />
        )}

        {/* 显示控制条 */}
        {(showControls || isLocked) && (
          <PlayerControls
            showControls={showControls}
            setShowControls={setShowControls}
            deviceType={deviceType}
            vrPlayerRef={vrPlayerRef}
          />
        )}

        {/* 亮度提示浮层 */}
        {brightnessOverlay !== null && (
          <View style={playStyles.brightnessOverlay} pointerEvents="none">
            <View style={playStyles.brightnessBar}>
              <View style={[playStyles.brightnessFill, { height: `${Math.round(brightnessOverlay * 100)}%` as any }]} />
            </View>
          </View>
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
      <VRSettingsPanel
        visible={showVRSettingsModal}
        onClose={() => setShowVRSettingsModal(false)}
      />
    </ThemedView>
  );
}

const playStyles = StyleSheet.create({
  brightnessOverlay: {
    position: "absolute",
    left: 16,
    top: "20%",
    bottom: "20%",
    width: 36,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  brightnessBar: {
    width: 4,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 2,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  brightnessFill: {
    width: "100%",
    backgroundColor: "#FFD700",
    borderRadius: 2,
  },
});
