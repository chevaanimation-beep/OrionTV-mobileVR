import React, { useRef, useCallback, useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, TouchableOpacity, PanResponder, LayoutChangeEvent } from "react-native";
import { Pause, Play, SkipForward, List, Tv, ArrowDownToDot, ArrowUpFromDot, Gauge, ArrowLeft, Glasses, Settings, Lock, LockOpen, RotateCcw } from "lucide-react-native";
import { ThemedText } from "@/components/ThemedText";
import { MediaButton } from "@/components/MediaButton";
import { useRouter } from "expo-router";

import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { useSources } from "@/stores/sourceStore";

interface PlayerControlsProps {
  showControls: boolean;
  setShowControls: (show: boolean) => void;
  deviceType?: string;
  vrPlayerRef?: React.RefObject<{ seekTo: (ms: number) => void; play: () => void; pause: () => void; }>;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({ showControls, setShowControls, deviceType = "tv", vrPlayerRef }) => {
  const router = useRouter();
  const isMobile = deviceType === "mobile" || deviceType === "tablet";
  const progressBarWidth = useRef(0);

  const {
    currentEpisodeIndex,
    episodes,
    status,
    isSeeking,
    seekPosition,
    progressPosition,
    playbackRate,
    togglePlayPause,
    playEpisode,
    setShowEpisodeModal,
    setShowSourceModal,
    setShowSpeedModal,
    setIntroEndTime,
    setOutroStartTime,
    introEndTime,
    outroStartTime,
    vrSBSMode,
    setVRSBSMode,
    setShowVRSettingsModal,
    isLocked,
    setIsLocked,
    isRotated,
    setIsRotated,
    videoRef,
  } = usePlayerStore();

  const { detail } = useDetailStore();
  const resources = useSources();

  const videoTitle = detail?.title || "";
  const currentEpisode = episodes[currentEpisodeIndex];
  const currentEpisodeTitle = currentEpisode?.title;
  const currentSource = resources.find((r) => r.source === detail?.source);
  const currentSourceName = currentSource?.source_name;
  const hasNextEpisode = currentEpisodeIndex < (episodes.length || 0) - 1;

  const formatTime = (milliseconds: number) => {
    if (!milliseconds) return "00:00";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const onPlayNextEpisode = () => {
    if (hasNextEpisode) {
      playEpisode(currentEpisodeIndex + 1);
    }
  };

  const onProgressBarLayout = useCallback((e: LayoutChangeEvent) => {
    progressBarWidth.current = e.nativeEvent.layout.width;
  }, []);

  const seekToPosition = useCallback((locationX: number) => {
    if (!status?.isLoaded || !status.durationMillis || progressBarWidth.current <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / progressBarWidth.current));
    const newPositionMs = Math.floor(ratio * status.durationMillis);
    if (vrSBSMode && vrPlayerRef?.current) {
      // VR 模式：走原生播放器的 seekTo 命令
      vrPlayerRef.current.seekTo(newPositionMs);
    } else {
      videoRef?.current?.setPositionAsync(newPositionMs);
    }
  }, [status, videoRef, vrSBSMode, vrPlayerRef]);

  const progressPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        seekToPosition(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        seekToPosition(evt.nativeEvent.locationX);
      },
    })
  ).current;

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // ===== Lock screen auto-hide logic =====
  const [showUnlockBtn, setShowUnlockBtn] = useState(false);
  const unlockTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isLocked) {
      setShowUnlockBtn(true);
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = setTimeout(() => setShowUnlockBtn(false), 2000);
    } else {
      setShowUnlockBtn(false);
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    }
    return () => {
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    };
  }, [isLocked]);

  const handleLockedScreenTap = useCallback(() => {
    if (!showUnlockBtn) {
      // 如果当前没显示解锁按钮，点击屏幕则唤出按钮并重新计时 2 秒
      setShowUnlockBtn(true);
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = setTimeout(() => setShowUnlockBtn(false), 2000);
    }
  }, [showUnlockBtn]);

  // ===== Lock screen overlay =====
  if (isLocked) {
    return (
      <View style={mobileStyles.lockedOverlay} pointerEvents="box-none">
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={handleLockedScreenTap}
        />
        {showUnlockBtn && (
          <TouchableOpacity
            style={mobileStyles.unlockBtn}
            onPress={() => setIsLocked(false)}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          >
            <Lock color="rgba(255,255,255,0.7)" size={28} />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ===== Mobile Layout =====
  if (isMobile) {
    return (
      <View style={mobileStyles.controlsOverlay} pointerEvents="box-none">
        {/* Top bar */}
        <View style={mobileStyles.topBar}>
          <TouchableOpacity onPress={handleBack} style={mobileStyles.backButton}>
            <ArrowLeft color="white" size={22} />
          </TouchableOpacity>
          <Text style={mobileStyles.title} numberOfLines={1}>
            {videoTitle} {currentEpisodeTitle ? `- ${currentEpisodeTitle}` : ""}
            {currentSourceName ? ` (${currentSourceName})` : ""}
          </Text>
          <View style={mobileStyles.topSpacer} />
        </View>

        {/* Bottom controls */}
        <View style={mobileStyles.bottomArea}>
          {/* Progress bar (touchable) */}
          <View style={mobileStyles.progressRow}>
            <ThemedText style={mobileStyles.timeText}>
              {status?.isLoaded ? formatTime(status.positionMillis) : "00:00"}
            </ThemedText>
            <View
              style={mobileStyles.progressBarContainer}
              onLayout={onProgressBarLayout}
              {...progressPanResponder.panHandlers}
            >
              <View style={mobileStyles.progressBarBackground} />
              <View
                style={[
                  mobileStyles.progressBarFilled,
                  { width: `${(isSeeking ? seekPosition : progressPosition) * 100}%` },
                ]}
              />
            </View>
            <ThemedText style={mobileStyles.timeText}>
              {status?.isLoaded ? formatTime(status.durationMillis || 0) : "00:00"}
            </ThemedText>
          </View>

          {/* Control buttons */}
          <View style={mobileStyles.controlButtons}>
            <TouchableOpacity onPress={togglePlayPause} style={mobileStyles.controlBtn}>
              {status?.isLoaded && status.isPlaying ? (
                <Pause color="white" size={22} />
              ) : (
                <Play color="white" size={22} />
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onPlayNextEpisode} style={mobileStyles.controlBtn} disabled={!hasNextEpisode}>
              <SkipForward color={hasNextEpisode ? "white" : "#666"} size={20} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowSpeedModal(true)} style={mobileStyles.controlBtn}>
              <Gauge color="white" size={20} />
              {playbackRate !== 1.0 && (
                <Text style={mobileStyles.badgeText}>{playbackRate}x</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowEpisodeModal(true)} style={mobileStyles.controlBtn}>
              <List color="white" size={20} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowSourceModal(true)} style={mobileStyles.controlBtn}>
              <Tv color="white" size={20} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setVRSBSMode(!vrSBSMode)}
              style={[mobileStyles.controlBtn, vrSBSMode && mobileStyles.activeBtn]}
            >
              <Glasses color={vrSBSMode ? "#4FC3F7" : "white"} size={20} />
              {vrSBSMode && <Text style={mobileStyles.activeBadge}>VR</Text>}
            </TouchableOpacity>

            {vrSBSMode && (
              <TouchableOpacity
                onPress={() => setShowVRSettingsModal(true)}
                style={mobileStyles.controlBtn}
              >
                <Settings color="white" size={20} />
              </TouchableOpacity>
            )}

            {/* 旋转按鈕：90度旋转屏幕（模拟横竖屏切换） */}
            <TouchableOpacity
              onPress={() => setIsRotated(!isRotated)}
              style={[mobileStyles.controlBtn, isRotated && mobileStyles.activeBtn]}
            >
              <RotateCcw color={isRotated ? "#4FC3F7" : "white"} size={20} />
            </TouchableOpacity>

            {/* 锁屏按鈕 */}
            <TouchableOpacity
              onPress={() => setIsLocked(true)}
              style={mobileStyles.controlBtn}
            >
              <LockOpen color="white" size={20} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ===== TV Layout (unchanged) =====
  return (
    <View style={styles.controlsOverlay}>
      <View style={styles.topControls}>
        <Text style={styles.controlTitle}>
          {videoTitle} {currentEpisodeTitle ? `- ${currentEpisodeTitle}` : ""}{" "}
          {currentSourceName ? `(${currentSourceName})` : ""}
        </Text>
      </View>

      <View style={styles.bottomControlsContainer}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground} />
          <View
            style={[
              styles.progressBarFilled,
              {
                width: `${(isSeeking ? seekPosition : progressPosition) * 100}%`,
              },
            ]}
          />
          <Pressable style={styles.progressBarTouchable} />
        </View>

        <ThemedText style={{ color: "white", marginTop: 5 }}>
          {status?.isLoaded
            ? `${formatTime(status.positionMillis)} / ${formatTime(status.durationMillis || 0)}`
            : "00:00 / 00:00"}
        </ThemedText>

        <View style={styles.bottomControls}>
          <MediaButton onPress={setIntroEndTime} timeLabel={introEndTime ? formatTime(introEndTime) : undefined}>
            <ArrowDownToDot color="white" size={24} />
          </MediaButton>

          <MediaButton onPress={togglePlayPause} hasTVPreferredFocus={showControls}>
            {status?.isLoaded && status.isPlaying ? (
              <Pause color="white" size={24} />
            ) : (
              <Play color="white" size={24} />
            )}
          </MediaButton>

          <MediaButton onPress={onPlayNextEpisode} disabled={!hasNextEpisode}>
            <SkipForward color={hasNextEpisode ? "white" : "#666"} size={24} />
          </MediaButton>

          <MediaButton onPress={setOutroStartTime} timeLabel={outroStartTime ? formatTime(outroStartTime) : undefined}>
            <ArrowUpFromDot color="white" size={24} />
          </MediaButton>

          <MediaButton onPress={() => setShowEpisodeModal(true)}>
            <List color="white" size={24} />
          </MediaButton>

          <MediaButton onPress={() => setShowSpeedModal(true)} timeLabel={playbackRate !== 1.0 ? `${playbackRate}x` : undefined}>
            <Gauge color="white" size={24} />
          </MediaButton>

          <MediaButton onPress={() => setShowSourceModal(true)}>
            <Tv color="white" size={24} />
          </MediaButton>

          <MediaButton onPress={() => setVRSBSMode(!vrSBSMode)}>
            <Glasses color={vrSBSMode ? "#4FC3F7" : "white"} size={24} />
          </MediaButton>

          {vrSBSMode && (
            <MediaButton onPress={() => setShowVRSettingsModal(true)}>
              <Settings color="white" size={24} />
            </MediaButton>
          )}
        </View>
      </View>
    </View>
  );
};

// ===== Mobile Styles =====
const mobileStyles = StyleSheet.create({
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "space-between",
    zIndex: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    padding: 8,
  },
  title: {
    flex: 1,
    color: "white",
    fontSize: 14,
    fontWeight: "600",
    marginHorizontal: 8,
  },
  topSpacer: {
    width: 38,
  },
  bottomArea: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  timeText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    minWidth: 42,
    textAlign: "center",
  },
  progressBarContainer: {
    flex: 1,
    height: 30,
    marginHorizontal: 8,
    justifyContent: "center",
  },
  progressBarBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
  },
  progressBarFilled: {
    position: "absolute",
    left: 0,
    height: 4,
    backgroundColor: "#4FC3F7",
    borderRadius: 2,
  },
  controlButtons: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  controlBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
  },
  badgeText: {
    color: "#4FC3F7",
    fontSize: 11,
    fontWeight: "bold",
    marginLeft: 2,
  },
  activeBtn: {
    backgroundColor: "rgba(79, 195, 247, 0.2)",
    borderRadius: 8,
  },
  activeBadge: {
    color: "#4FC3F7",
    fontSize: 10,
    fontWeight: "bold",
    marginLeft: 2,
  },
  // 锁屏 overlay
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 24,
    zIndex: 30,
  },
  unlockBtn: {
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
});

// ===== TV Styles (original) =====
const styles = StyleSheet.create({
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "space-between",
    padding: 20,
  },
  topControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  controlTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 10,
  },
  bottomControlsContainer: {
    width: "100%",
    alignItems: "center",
  },
  bottomControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 15,
  },
  progressBarContainer: {
    width: "100%",
    height: 8,
    position: "relative",
    marginTop: 10,
  },
  progressBarBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 4,
  },
  progressBarFilled: {
    position: "absolute",
    left: 0,
    height: 8,
    backgroundColor: "#fff",
    borderRadius: 4,
  },
  progressBarTouchable: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 30,
    top: -10,
    zIndex: 10,
  },
  controlButton: {
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  topRightContainer: {
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
  },
  resolutionText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
