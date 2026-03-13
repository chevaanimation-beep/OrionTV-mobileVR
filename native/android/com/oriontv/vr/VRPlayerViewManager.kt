package com.oriontv.vr

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * React Native ViewManager 桥接
 * 将 VRPlayerView 暴露为 <NativeVRPlayer> 组件
 *
 * Props: uri, rate, scale, gap, distortionK1, distortionK2, sbs3dMode, paused
 * Events: onVRStatusUpdate
 * Commands: seekTo
 */
class VRPlayerViewManager : SimpleViewManager<VRPlayerView>() {

    companion object {
        const val REACT_CLASS = "NativeVRPlayer"
        const val COMMAND_SEEK_TO = 1
        const val COMMAND_PLAY = 2
        const val COMMAND_PAUSE = 3
    }

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(reactContext: ThemedReactContext): VRPlayerView {
        val view = VRPlayerView(reactContext)

        // 将播放状态回调发送到 JS 层
        view.onStatusUpdate = { positionMs, durationMs, isPlaying ->
            val event: WritableMap = Arguments.createMap()
            event.putDouble("position", positionMs.toDouble())
            event.putDouble("duration", durationMs.toDouble())
            event.putBoolean("isPlaying", isPlaying)

            reactContext.getJSModule(RCTEventEmitter::class.java)
                .receiveEvent(view.id, "onVRStatusUpdate", event)
        }

        return view
    }

    // ===== Props =====

    @ReactProp(name = "uri")
    fun setUri(view: VRPlayerView, uri: String?) {
        view.setUri(uri)
    }

    @ReactProp(name = "rate", defaultFloat = 1.0f)
    fun setRate(view: VRPlayerView, rate: Float) {
        view.setRate(rate)
    }

    @ReactProp(name = "scale", defaultInt = 85)
    fun setScale(view: VRPlayerView, scale: Int) {
        view.setScale(scale)
    }

    @ReactProp(name = "gap", defaultInt = 0)
    fun setGap(view: VRPlayerView, gap: Int) {
        view.setGap(gap)
    }

    @ReactProp(name = "distortionK1", defaultFloat = 0.0f)
    fun setDistortionK1(view: VRPlayerView, k1: Float) {
        view.setDistortion(k1, 0f)
    }

    @ReactProp(name = "distortionK2", defaultFloat = 0.0f)
    fun setDistortionK2(view: VRPlayerView, k2: Float) {
        view.setDistortion(0f, k2)
    }

    @ReactProp(name = "sbs3dMode", defaultBoolean = false)
    fun setSBS3DMode(view: VRPlayerView, enabled: Boolean) {
        view.setSBS3DMode(enabled)
    }

    @ReactProp(name = "paused", defaultBoolean = false)
    fun setPaused(view: VRPlayerView, paused: Boolean) {
        if (paused) view.pause() else view.play()
    }

    @ReactProp(name = "seekTo", defaultDouble = -1.0)
    fun setSeekTo(view: VRPlayerView, positionMs: Double) {
        if (positionMs >= 0) {
            view.seekTo(positionMs.toLong())
        }
    }

    // ===== Events =====

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any>? {
        return MapBuilder.builder<String, Any>()
            .put("onVRStatusUpdate", MapBuilder.of("registrationName", "onVRStatusUpdate"))
            .build()
    }

    // ===== Commands (imperative actions from JS) =====

    override fun getCommandsMap(): Map<String, Int>? {
        return MapBuilder.of(
            "seekTo", COMMAND_SEEK_TO,
            "play", COMMAND_PLAY,
            "pause", COMMAND_PAUSE
        )
    }

    override fun receiveCommand(view: VRPlayerView, commandId: String?, args: ReadableArray?) {
        when (commandId) {
            "seekTo" -> {
                val positionMs = args?.getDouble(0)?.toLong() ?: 0
                view.seekTo(positionMs)
            }
            "play" -> view.play()
            "pause" -> view.pause()
        }
    }

    // ===== Lifecycle =====

    override fun onDropViewInstance(view: VRPlayerView) {
        view.onHostDestroy()
        super.onDropViewInstance(view)
    }
}
