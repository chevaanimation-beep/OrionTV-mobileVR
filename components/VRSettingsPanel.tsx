import React from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import { X } from "lucide-react-native";
import usePlayerStore from "@/stores/playerStore";

interface VRSettingsPanelProps {
    visible: boolean;
    onClose: () => void;
}

/**
 * VR 设置面板
 * 调节画面大小、双屏间距、畸变矫正
 */
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
                    <View style={styles.settingRow}>
                        <Text style={styles.label}>画面大小</Text>
                        <Text style={styles.value}>{vrScale}%</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={50}
                        maximumValue={100}
                        step={1}
                        value={vrScale}
                        onValueChange={setVRScale}
                        minimumTrackTintColor="#4FC3F7"
                        maximumTrackTintColor="#555"
                        thumbTintColor="#4FC3F7"
                    />

                    {/* 双屏间距 */}
                    <View style={styles.settingRow}>
                        <Text style={styles.label}>双屏间距</Text>
                        <Text style={styles.value}>{vrGap}</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={-200}
                        maximumValue={200}
                        step={5}
                        value={vrGap}
                        onValueChange={(v: number) => setVRGap(Math.round(v))}
                        minimumTrackTintColor="#4FC3F7"
                        maximumTrackTintColor="#555"
                        thumbTintColor="#4FC3F7"
                    />

                    {/* 畸变矫正 K1 */}
                    <View style={styles.settingRow}>
                        <Text style={styles.label}>畸变矫正 K1</Text>
                        <Text style={styles.value}>{vrDistortionK1.toFixed(2)}</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={0}
                        maximumValue={0.5}
                        step={0.01}
                        value={vrDistortionK1}
                        onValueChange={setVRDistortionK1}
                        minimumTrackTintColor="#4FC3F7"
                        maximumTrackTintColor="#555"
                        thumbTintColor="#4FC3F7"
                    />

                    {/* 畸变矫正 K2 */}
                    <View style={styles.settingRow}>
                        <Text style={styles.label}>畸变矫正 K2</Text>
                        <Text style={styles.value}>{vrDistortionK2.toFixed(2)}</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={0}
                        maximumValue={0.3}
                        step={0.01}
                        value={vrDistortionK2}
                        onValueChange={setVRDistortionK2}
                        minimumTrackTintColor="#4FC3F7"
                        maximumTrackTintColor="#555"
                        thumbTintColor="#4FC3F7"
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
    settingRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
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
    slider: {
        width: "100%",
        height: 36,
    },
    resetBtn: {
        marginTop: 16,
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
