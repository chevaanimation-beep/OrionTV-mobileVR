package com.oriontv.vr

import android.app.Activity
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 屏幕亮度控制原生模块
 * JS 调用: NativeModules.BrightnessModule.setBrightness(0.5)
 * 范围: 0.0（最暗）~ 1.0（最亮）
 */
class BrightnessModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BrightnessModule"

    @ReactMethod
    fun setBrightness(brightness: Float) {
        val activity = currentActivity ?: return
        activity.runOnUiThread {
            val lp = activity.window.attributes
            lp.screenBrightness = brightness.coerceIn(0.01f, 1.0f)
            activity.window.attributes = lp
        }
    }

    @ReactMethod
    fun getBrightness(promise: com.facebook.react.bridge.Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(0.5f)
            return
        }
        val brightness = activity.window.attributes.screenBrightness
        // -1.0 表示跟随系统，返回 0.5 作为默认值
        promise.resolve(if (brightness < 0) 0.5f else brightness)
    }
}
