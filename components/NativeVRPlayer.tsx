import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import {
    requireNativeComponent,
    UIManager,
    findNodeHandle,
    ViewStyle,
    Platform,
} from "react-native";

// 原生组件类型定义
interface NativeVRPlayerProps {
    uri?: string;
    rate?: number;
    scale?: number;
    gap?: number;
    distortionK1?: number;
    distortionK2?: number;
    sbs3dMode?: boolean;
    paused?: boolean;
    seekTo?: number;
    style?: ViewStyle;
    onVRStatusUpdate?: (event: {
        nativeEvent: {
            position: number;
            duration: number;
            isPlaying: boolean;
            isBuffering: boolean; // 新增：实际缓冲状态
        };
    }) => void;
}

export interface NativeVRPlayerRef {
    seekTo: (positionMs: number) => void;
    play: () => void;
    pause: () => void;
}

// 仅在 Android 上注册原生组件
const NativeVRPlayerComponent =
    Platform.OS === "android"
        ? requireNativeComponent<NativeVRPlayerProps>("NativeVRPlayer")
        : null;

/**
 * 原生 VR SBS 播放器
 * 使用 OpenGL ES 2.0 渲染，单一解码器，帧级同步
 *
 * 用法:
 * <NativeVRPlayer
 *   ref={vrPlayerRef}
 *   uri="https://example.com/video.mp4"
 *   rate={1.0}
 *   scale={85}
 *   gap={0}
 *   paused={false}
 *   onVRStatusUpdate={(e) => console.log(e.nativeEvent)}
 *   style={{ flex: 1 }}
 * />
 */
export const NativeVRPlayer = forwardRef<NativeVRPlayerRef, NativeVRPlayerProps>(
    (props, ref) => {
        const nativeRef = useRef<any>(null);

        const sendCommand = useCallback(
            (command: string, args: any[] = []) => {
                const handle = findNodeHandle(nativeRef.current);
                if (handle != null) {
                    const commandId = UIManager.getViewManagerConfig("NativeVRPlayer").Commands[command];
                    UIManager.dispatchViewManagerCommand(handle, commandId ?? command, args);
                }
            },
            []
        );

        useImperativeHandle(ref, () => ({
            seekTo: (positionMs: number) => sendCommand("seekTo", [positionMs]),
            play: () => sendCommand("play", []),
            pause: () => sendCommand("pause", []),
        }));

        if (Platform.OS !== "android" || !NativeVRPlayerComponent) {
            // 非 Android 平台返回空（或 fallback）
            return null;
        }

        return <NativeVRPlayerComponent ref={nativeRef} {...props} />;
    }
);

NativeVRPlayer.displayName = "NativeVRPlayer";
