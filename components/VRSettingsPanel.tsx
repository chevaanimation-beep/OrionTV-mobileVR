import React, { useRef, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    PanResponder,
    LayoutChangeEvent,
} from "react-native";
import { X } from "lucide-react-native";
import usePlayerStore from "@/stores/playerStore";

// ===== 自定义滑块组件（纯 View + PanResponder，兼容 react-native-tvos） =====
interface CustomSliderProps {
    value: number;
    minimumValue: number;
    maximumValue: number;
    step: number;
    onValueChange: (value: number) => void;
    label: string;
    formatValue?: (value: number) => string;
}

const CustomSlider: React.FC<CustomSliderProps> = ({
    value,
    minimumValue,
    maximumValue,
    step,
    onValueChange,
    label,
    formatValue,
}) => {
    const trackWidth = useRef(0);
    const [dragging, setDragging] = useState(false);

    const fraction = (value - minimumValue) / (maximumValue - minimumValue);
    const displayValue = formatValue ? formatValue(value) : String(value);

    const clampAndSnap = (raw: number) => {
        const clamped = Math.max(minimumValue, Math.min(maximumValue, raw));
        return Math.round(clamped / step) * step;
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (evt) => {
                setDragging(true);
                const x = evt.nativeEvent.locationX;
                const frac = x / trackWidth.current;
                const raw = minimumValue + frac * (maximumValue - minimumValue);
                onValueChange(clampAndSnap(raw));
            },
            onPanResponderMove: (evt) => {
                const x = evt.nativeEvent.locationX;
                const frac = x / trackWidth.current;
                const raw = minimumValue + frac * (maximumValue - minimumValue);
                onValueChange(clampAndSnap(raw));
            },
            onPanResponderRelease: () => {
                setDragging(false);
            },
            onPanResponderTerminate: () => {
                setDragging(false);
            },
        })
    ).current;

    return (
        <View style={sliderStyles.container}>
            <View style={sliderStyles.labelRow}>
                <Text style={sliderStyles.label}>{label}</Text>
                <Text style={[sliderStyles.value, dragging && sliderStyles.valueDragging]}>
                    {displayValue}
                </Text>
            </View>
            <View
                style={sliderStyles.track}
                onLayout={(e: LayoutChangeEvent) => {
                    trackWidth.current = e.nativeEvent.layout.width;
                }}
                {...panResponder.panHandlers}
            >
                <View style={sliderStyles.trackBg} />
                <View
                    style={[
                        sliderStyles.trackFill,
                        { width: `${Math.max(0, Math.min(100, fraction * 100))}%` },
                    ]}
                />
                <View
                    style={[
                        sliderStyles.thumb,
                        {
                            left: `${Math.max(0, Math.min(100, fraction * 100))}%`,
                        },
                        dragging && sliderStyles.thumbActive,
                    ]}
                />
            </View>
        </View>
    );
};

const sliderStyles = StyleSheet.create({
    container: {
        marginBottom: 12,
    },
    labelRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 6,
    },
    label: {
        color: "#ccc",
        fontSize: 14,
    },
    value: {
        color: "#4FC3F7",
        fontSize: 14,
        fontWeight: "bold",
        minWidth: 50,
        textAlign: "right",
    },
    valueDragging: {
        color: "#fff",
    },
    track: {
        height: 36,
        justifyContent: "center",
        position: "relative",
    },
    trackBg: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: "#555",
        borderRadius: 2,
    },
    trackFill: {
        position: "absolute",
        left: 0,
        height: 4,
        backgroundColor: "#4FC3F7",
        borderRadius: 2,
    },
    thumb: {
        position: "absolute",
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: "#4FC3F7",
        marginLeft: -10,
        top: 8,
        elevation: 3,
        shadowColor: "#4FC3F7",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
    },
    thumbActive: {
        width: 24,
        height: 24,
        borderRadius: 12,
        marginLeft: -12,
        top: 6,
        backgroundColor: "#fff",
    },
});

// ===== VR 设置面板 =====
interface VRSettingsPanelProps {
    visible: boolean;
    onClose: () => void;
}

export const VRSettingsPanel: React.FC<VRSettingsPanelProps> = ({
    visible,
    onClose,
}) => {
    const {
        vrScale,
        vrGap,
        vrDistortionK1,
        vrDistortionK2,
        setVRScale,
        setVRGap,
        setVRDistortionK1,
        setVRDistortionK2,
    } = usePlayerStore();

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <View style={styles.panel}>
                    {/* 标题栏 */}
                    <View style={styles.header}>
                        <Text style={styles.title}>🥽 VR 设置</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <X color="white" size={20} />
                        </TouchableOpacity>
                    </View>

                    {/* 画面大小 */}
                    <CustomSlider
                        label="画面大小"
                        value={vrScale}
                        minimumValue={50}
                        maximumValue={100}
                        step={1}
                        onValueChange={setVRScale}
                        formatValue={(v) => `${Math.round(v)}%`}
                    />

                    {/* 双屏间距 */}
                    <CustomSlider
                        label="双屏间距"
                        value={vrGap}
                        minimumValue={-200}
                        maximumValue={200}
                        step={5}
                        onValueChange={(v) => setVRGap(Math.round(v))}
                        formatValue={(v) => `${Math.round(v)}`}
                    />

                    {/* 畸变矫正 K1 */}
                    <CustomSlider
                        label="畸变矫正 K1"
                        value={vrDistortionK1}
                        minimumValue={0}
                        maximumValue={0.5}
                        step={0.01}
                        onValueChange={setVRDistortionK1}
                        formatValue={(v) => v.toFixed(2)}
                    />

                    {/* 畸变矫正 K2 */}
                    <CustomSlider
                        label="畸变矫正 K2"
                        value={vrDistortionK2}
                        minimumValue={0}
                        maximumValue={0.3}
                        step={0.01}
                        onValueChange={setVRDistortionK2}
                        formatValue={(v) => v.toFixed(2)}
                    />

                    {/* 重置按钮 */}
                    <TouchableOpacity
                        style={styles.resetBtn}
                        onPress={() => {
                            setVRScale(85);
                            setVRGap(0);
                            setVRDistortionK1(0);
                            setVRDistortionK2(0);
                        }}
                    >
                        <Text style={styles.resetText}>恢复默认</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        justifyContent: "center",
        alignItems: "center",
    },
    panel: {
        width: "80%",
        maxWidth: 400,
        backgroundColor: "rgba(30, 30, 30, 0.95)",
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: "rgba(79, 195, 247, 0.3)",
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    title: {
        color: "white",
        fontSize: 18,
        fontWeight: "bold",
    },
    closeBtn: {
        padding: 4,
    },
    resetBtn: {
        marginTop: 8,
        alignSelf: "center",
        paddingVertical: 8,
        paddingHorizontal: 24,
        borderRadius: 8,
        backgroundColor: "rgba(79, 195, 247, 0.2)",
        borderWidth: 1,
        borderColor: "rgba(79, 195, 247, 0.4)",
    },
    resetText: {
        color: "#4FC3F7",
        fontSize: 14,
        fontWeight: "bold",
    },
});
