package com.oriontv.vr

import android.content.Context
import android.net.Uri
import android.opengl.GLSurfaceView
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.Surface
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.io.File

/**
 * React Native 原生 VR 播放器视图
 * 单一 ExoPlayer 解码 → SurfaceTexture → OpenGL 左右眼渲染
 * 帧级同步，零延迟
 *
 * 优化：
 * - DefaultLoadControl：最小缓冲 30s，最大缓冲 2min
 * - SimpleCache：512MB 磁盘缓存，避免重复下载已缓冲内容
 * - pendingSeekPosition：支持播放器就绪前的位置预设（模式切换时从当前时间点继续播放）
 * - isBuffering 状态上报：缓冲时通知 JS 层显示加载动画
 */
class VRPlayerView(context: Context) : FrameLayout(context) {

    companion object {
        private const val TAG = "VRPlayerView"

        // 512MB 磁盘缓存，单例，所有 VRPlayerView 实例共享
        @Volatile
        private var videoCache: SimpleCache? = null

        fun getVideoCache(context: Context): SimpleCache {
            return videoCache ?: synchronized(this) {
                videoCache ?: SimpleCache(
                    File(context.applicationContext.cacheDir, "vr_video_cache"),
                    LeastRecentlyUsedCacheEvictor(512L * 1024 * 1024), // 512 MB
                    StandaloneDatabaseProvider(context.applicationContext)
                ).also { videoCache = it }
            }
        }
    }

    private val glSurfaceView: GLSurfaceView
    private val renderer: SBSRenderer
    private var player: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var currentUri: String? = null
    private var pendingRate: Float = 1.0f
    // 模式切换时预存目标位置，等播放器就绪（STATE_READY）后再执行
    private var pendingSeekPosition: Long = -1L
    private var currentScale: Int = 85
    private var currentGap: Int = 0

    // 回调：播放状态通知 JS 层（新增 isBuffering 参数）
    var onStatusUpdate: ((positionMs: Long, durationMs: Long, isPlaying: Boolean, isBuffering: Boolean) -> Unit)? = null

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let {
                if (it.isPlaying) {
                    onStatusUpdate?.invoke(it.currentPosition, it.duration, true, false)
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

        // 关键：GLSurfaceView 不拦截任何触摸事件，全部透传给 React Native 层
        glSurfaceView.setOnTouchListener { _, _ -> false }

        addView(glSurfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    // 同样透传触摸事件，不消费
    override fun onTouchEvent(event: MotionEvent): Boolean = false
    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = false

    // ===== Props from React Native =====

    fun setUri(uri: String?) {
        if (uri == null || uri == currentUri) return
        currentUri = uri

        val surface = renderer.cachedSurface
        if (surface != null) {
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

    fun seekTo(positionMs: Long) {
        val p = player
        if (p != null && (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING)) {
            // 播放器已就绪，直接 seek
            p.seekTo(positionMs)
        } else {
            // 播放器尚未就绪（如模式刚切换），暂存位置，等 STATE_READY 后执行
            pendingSeekPosition = positionMs
        }
    }

    fun getPosition(): Long = player?.currentPosition ?: 0
    fun getDuration(): Long = player?.duration ?: 0
    fun isPlaying(): Boolean = player?.isPlaying == true

    // ===== 内部 =====

    private fun initPlayer(surface: Surface, uri: String) {
        releasePlayer()

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .setDefaultRequestProperties(mapOf("Referer" to "https://www.bilibili.com"))

        val upstreamFactory = DefaultDataSource.Factory(context, httpDataSourceFactory)

        // 磁盘缓存包装：已下载的分片不再重复请求
        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(getVideoCache(context))
            .setUpstreamDataSourceFactory(upstreamFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        // 加大内存缓冲区：
        //   minBufferMs  = 30s  → 低于此值才继续下载
        //   maxBufferMs  = 2min → 最多预加载 2 分钟
        //   playbackMs   = 1.5s → 积累 1.5s 就开始播放（减少首帧延迟）
        //   rebufferMs   = 3s   → 卡顿后积累 3s 再恢复（减少二次卡顿）
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                30_000,
                120_000,
                1_500,
                3_000
            )
            .build()

        val exoPlayer = ExoPlayer.Builder(context)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(context).setDataSourceFactory(cacheDataSourceFactory)
            )
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
                when (playbackState) {
                    Player.STATE_READY -> {
                        // 应用模式切换时预存的目标位置
                        if (pendingSeekPosition > 0) {
                            exoPlayer.seekTo(pendingSeekPosition)
                            pendingSeekPosition = -1L
                        }
                        onStatusUpdate?.invoke(
                            exoPlayer.currentPosition, exoPlayer.duration, exoPlayer.isPlaying, false
                        )
                    }
                    Player.STATE_BUFFERING -> {
                        // 告知 JS 层正在缓冲，以便显示加载动画
                        onStatusUpdate?.invoke(
                            exoPlayer.currentPosition, exoPlayer.duration, false, true
                        )
                    }
                    else -> {}
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                onStatusUpdate?.invoke(exoPlayer.currentPosition, exoPlayer.duration, isPlaying, false)
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
