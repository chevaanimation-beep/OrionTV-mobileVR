import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { getCommonResponsiveStyles } from '@/utils/ResponsiveStyles';
import ResponsiveNavigation from '@/components/navigation/ResponsiveNavigation';
import ResponsiveHeader from '@/components/navigation/ResponsiveHeader';
import useDownloadStore, { formatBytes } from '@/stores/downloadStore';
import { DownloadedVideo } from '@/services/downloadManager';
import { Trash2, PlayCircle, ChevronDown, ChevronUp, HardDrive } from 'lucide-react-native';

export default function DownloadsScreen() {
  const router = useRouter();
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;
  const [expandedVideos, setExpandedVideos] = useState<Set<string>>(new Set());

  const { downloadedVideos, loading, loadDownloads, deleteVideo, deleteEpisode } =
    useDownloadStore();

  useFocusEffect(
    useCallback(() => {
      loadDownloads();
    }, [loadDownloads]),
  );

  const toggleExpand = (key: string) => {
    setExpandedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDeleteVideo = (video: DownloadedVideo) => {
    Alert.alert(
      '删除下载',
      `确定要删除《${video.title}》的全部 ${video.episodes.length} 集缓存吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteVideo(video.source, video.id),
        },
      ],
    );
  };

  const handleDeleteEpisode = (video: DownloadedVideo, episodeIndex: number, label: string) => {
    Alert.alert('删除剧集', `确定要删除《${video.title}》${label} 的缓存吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => deleteEpisode(video.source, video.id, episodeIndex),
      },
    ]);
  };

  const handlePlayEpisode = (video: DownloadedVideo, episodeIndex: number, localPath: string) => {
    router.push({
      pathname: '/play',
      params: {
        q: video.title,
        source: video.source,
        id: video.id,
        episodeIndex: episodeIndex.toString(),
        localPath,
      },
    });
  };

  const dynamicStyles = createStyles(deviceType, spacing);

  const getTotalSize = () => {
    const total = downloadedVideos.reduce((sum, v) => sum + v.totalSize, 0);
    return formatBytes(total);
  };

  const renderEmptyState = () => (
    <View style={commonStyles.center}>
      <HardDrive size={64} color="#555" style={{ marginBottom: 16 }} />
      <ThemedText type="subtitle" style={dynamicStyles.emptyTitle}>
        暂无本地缓存
      </ThemedText>
      <ThemedText style={dynamicStyles.emptyDesc}>
        在影片详情页点击「缓存」按钮即可下载视频
      </ThemedText>
    </View>
  );

  const renderVideoCard = (video: DownloadedVideo) => {
    const videoKey = `${video.source}+${video.id}`;
    const isExpanded = expandedVideos.has(videoKey);
    const episodeCount = video.episodes.length;

    return (
      <View key={videoKey} style={dynamicStyles.videoCard}>
        {/* Card Header */}
        <View style={dynamicStyles.cardHeader}>
          <Image source={{ uri: video.poster }} style={dynamicStyles.poster} />
          <View style={dynamicStyles.videoInfo}>
            <Text style={dynamicStyles.videoTitle} numberOfLines={2}>
              {video.title}
            </Text>
            <Text style={dynamicStyles.videoMeta}>
              {video.year} · {video.sourceName}
            </Text>
            <Text style={dynamicStyles.videoStats}>
              {episodeCount} 集 · {formatBytes(video.totalSize)}
            </Text>
            <View style={dynamicStyles.cardActions}>
              <TouchableOpacity
                style={dynamicStyles.expandButton}
                onPress={() => toggleExpand(videoKey)}
                activeOpacity={0.7}
              >
                <Text style={dynamicStyles.expandButtonText}>
                  {isExpanded ? '收起剧集' : '展开剧集'}
                </Text>
                {isExpanded ? (
                  <ChevronUp size={14} color="#409CFF" />
                ) : (
                  <ChevronDown size={14} color="#409CFF" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={dynamicStyles.deleteVideoButton}
                onPress={() => handleDeleteVideo(video)}
                activeOpacity={0.7}
              >
                <Trash2 size={16} color="#FF453A" />
                <Text style={dynamicStyles.deleteButtonText}>全部删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Episode List */}
        {isExpanded && (
          <View style={dynamicStyles.episodeList}>
            {video.episodes.map((ep) => (
              <View key={ep.episodeIndex} style={dynamicStyles.episodeRow}>
                <TouchableOpacity
                  style={dynamicStyles.episodePlayArea}
                  onPress={() => handlePlayEpisode(video, ep.episodeIndex, ep.localPath)}
                  activeOpacity={0.7}
                >
                  <PlayCircle size={18} color="#409CFF" />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={dynamicStyles.episodeLabel}>{ep.episodeLabel}</Text>
                    <Text style={dynamicStyles.episodeSize}>{formatBytes(ep.fileSize)}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={dynamicStyles.episodeDeleteBtn}
                  onPress={() => handleDeleteEpisode(video, ep.episodeIndex, ep.episodeLabel)}
                  activeOpacity={0.7}
                >
                  <Trash2 size={16} color="#888" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {/* Storage info */}
      {downloadedVideos.length > 0 && (
        <View style={dynamicStyles.storageBar}>
          <HardDrive size={16} color="#888" />
          <Text style={dynamicStyles.storageText}>
            已缓存 {downloadedVideos.length} 部影片，共占用 {getTotalSize()}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : downloadedVideos.length === 0 ? (
        renderEmptyState()
      ) : (
        <ScrollView style={dynamicStyles.scrollView} contentContainerStyle={dynamicStyles.scrollContent}>
          {downloadedVideos.map(renderVideoCard)}
        </ScrollView>
      )}
    </ThemedView>
  );

  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="本地缓存" showBackButton={false} />
      {content}
    </ResponsiveNavigation>
  );
}

const createStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';

  return StyleSheet.create({
    container: {
      flex: 1,
    },
    storageBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing,
      paddingVertical: spacing * 0.75,
      backgroundColor: '#1a1a1a',
      borderBottomWidth: 1,
      borderBottomColor: '#2a2a2a',
      gap: 8,
    },
    storageText: {
      fontSize: 13,
      color: '#888',
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing,
      gap: spacing,
    },
    videoCard: {
      backgroundColor: '#1c1c1e',
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#2c2c2e',
    },
    cardHeader: {
      flexDirection: 'row',
      padding: spacing,
      gap: spacing,
    },
    poster: {
      width: isMobile ? 80 : 100,
      height: isMobile ? 110 : 140,
      borderRadius: 8,
      backgroundColor: '#333',
    },
    videoInfo: {
      flex: 1,
      justifyContent: 'flex-start',
    },
    videoTitle: {
      fontSize: isMobile ? 16 : 18,
      fontWeight: '600',
      color: '#fff',
      marginBottom: 4,
    },
    videoMeta: {
      fontSize: 12,
      color: '#888',
      marginBottom: 4,
    },
    videoStats: {
      fontSize: 12,
      color: '#409CFF',
      marginBottom: 10,
    },
    cardActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    expandButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      backgroundColor: 'rgba(64, 156, 255, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(64, 156, 255, 0.3)',
    },
    expandButtonText: {
      fontSize: 12,
      color: '#409CFF',
      fontWeight: '500',
    },
    deleteVideoButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      backgroundColor: 'rgba(255, 69, 58, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(255, 69, 58, 0.3)',
    },
    deleteButtonText: {
      fontSize: 12,
      color: '#FF453A',
      fontWeight: '500',
    },
    episodeList: {
      borderTopWidth: 1,
      borderTopColor: '#2c2c2e',
    },
    episodeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing,
      paddingVertical: spacing * 0.75,
      borderBottomWidth: 1,
      borderBottomColor: '#2a2a2a',
    },
    episodePlayArea: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    episodeLabel: {
      fontSize: 14,
      color: '#e5e5ea',
      fontWeight: '500',
    },
    episodeSize: {
      fontSize: 11,
      color: '#666',
      marginTop: 2,
    },
    episodeDeleteBtn: {
      padding: 8,
    },
    emptyTitle: {
      textAlign: 'center',
      marginBottom: 8,
      color: '#888',
    },
    emptyDesc: {
      textAlign: 'center',
      color: '#555',
      fontSize: 14,
      paddingHorizontal: 40,
      lineHeight: 20,
    },
  });
};
