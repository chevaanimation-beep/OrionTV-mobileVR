package com.oriontv.vr

import android.content.Context
import android.net.Uri
import android.opengl.GLSurfaceView
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * React Native 原生 VR 播放器视图
 * 单一 ExoPlayer 解码 → SurfaceTexture → OpenGL 左右眼渲染
 * 帧级同步，零延迟
 */
class VRPlayerView(context: Context) : FrameLayout(context) {

    companion object {
        private const val TAG = "VRPlayerView"
    }

    private val glSurfaceView: GLSurfaceView
    private val renderer: SBSRenderer
    private var player: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var currentUri: String? = null
    private var pendingRate: Float = 1.0f
    private var currentScale: Int = 85
    private var currentGap: Int = 0

    // 回调：播放状态通知 JS 层
    var onStatusUpdate: ((positionMs: Long, durationMs: Long, isPlaying: Boolean) -> Unit)? = null

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let {
                if (it.isPlaying) {
                    onStatusUpdate?.invoke(it.currentPosition, it.duration, it.isPlaying)
                }
            }
            handler.postDelayed(this, 500)
        }
    }

    init {
        glSurfaceView = GLSurfaceView(context)
        glSurfaceView.setEGLContextClientVersion(2)

        renderer = SBSRenderer(
            onSurfaceReady = { surface ->
                handler.post {
                    currentUri?.let { uri -> initPlayer(surface, uri) }
                }
            },
            requestRender = { glSurfaceView.requestRender() }
        )

        glSurfaceView.setRenderer(renderer)
        glSurfaceView.renderMode = GLSurfaceView.RENDERMODE_WHEN_DIRTY
        addView(glSurfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    // ===== Props from React Native =====

    fun setUri(uri: String?) {
        if (uri == null || uri == currentUri) return
        currentUri = uri

        val surface = renderer.cachedSurface
        if (surface != null) {
            // Surface 已准备好，直接切换视频
            initPlayer(surface, uri)
        }
        // 否则等 onSurfaceReady 回调
    }

    fun setRate(rate: Float) {
        pendingRate = rate
        player?.setPlaybackSpeed(rate)
    }

    fun setDisplayParams(scale: Int, gap: Int) {
        currentScale = scale
        currentGap = gap
        renderer.setDisplayParams(scale, gap)
    }

    fun setScale(scale: Int) {
        currentScale = scale
        renderer.setDisplayParams(currentScale, currentGap)
    }

    fun setGap(gap: Int) {
        currentGap = gap
        renderer.setDisplayParams(currentScale, currentGap)
    }

    fun setDistortion(k1: Float, k2: Float) {
        renderer.setDistortion(k1, k2)
    }

    fun setSBS3DMode(enabled: Boolean) {
        renderer.setSBS3DMode(enabled)
    }

    // ===== 播放控制 =====

    fun play() { player?.playWhenReady = true }
    fun pause() { player?.playWhenReady = false }

    fun seekTo(positionMs: Long) { player?.seekTo(positionMs) }
    fun getPosition(): Long = player?.currentPosition ?: 0
    fun getDuration(): Long = player?.duration ?: 0
    fun isPlaying(): Boolean = player?.isPlaying == true

    // ===== 内部 =====

    private fun initPlayer(surface: Surface, uri: String) {
        releasePlayer()

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .setDefaultRequestProperties(mapOf("Referer" to "https://www.bilibili.com"))

        val dataSourceFactory = DefaultDataSource.Factory(context, httpDataSourceFactory)

        val exoPlayer = ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(dataSourceFactory))
            .build()

        exoPlayer.setVideoSurface(surface)
        exoPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
        exoPlayer.setPlaybackSpeed(pendingRate)

        exoPlayer.addListener(object : Player.Listener {
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                renderer.setVideoSize(videoSize.width, videoSize.height)
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "Playback error: ${error.message}", error)
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    onStatusUpdate?.invoke(exoPlayer.currentPosition, exoPlayer.duration, exoPlayer.isPlaying)
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                onStatusUpdate?.invoke(exoPlayer.currentPosition, exoPlayer.duration, isPlaying)
            }
        })

        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        player = exoPlayer
        handler.post(progressRunnable)
    }

    private fun releasePlayer() {
        handler.removeCallbacks(progressRunnable)
        player?.release()
        player = null
    }

    // ===== 生命周期 =====

    fun onHostResume() {
        glSurfaceView.onResume()
        player?.playWhenReady = true
        handler.post(progressRunnable)
    }

    fun onHostPause() {
        glSurfaceView.onPause()
        player?.playWhenReady = false
        handler.removeCallbacks(progressRunnable)
    }

    fun onHostDestroy() {
        handler.removeCallbacksAndMessages(null)
        releasePlayer()
        renderer.release()
    }
}
