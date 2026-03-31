package com.oriontv.vr

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import fi.iki.elonen.NanoHTTPD
import java.io.File
import java.io.FileInputStream

class LocalServerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var server: LocalWebServer? = null
    // Use an unprivileged port that is likely open
    private val PORT = 18080

    override fun getName(): String {
        return "LocalServerModule"
    }

    @ReactMethod
    fun startServer(promise: Promise) {
        try {
            if (server == null) {
                server = LocalWebServer(PORT)
                server?.start()
            } else if (!server!!.isAlive) {
                server?.start()
            }
            promise.resolve("http://127.0.0.1:$PORT")
        } catch (e: Exception) {
            promise.reject("SERVER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopServer() {
        server?.stop()
        server = null
    }

    private inner class LocalWebServer(port: Int) : NanoHTTPD(port) {
        override fun serve(session: IHTTPSession): Response {
            val uri = session.uri
            // The file path is the exact URI path.
            // E.g. http://127.0.0.1:18080/data/user/0/com.oriontv/files/downloads/...
            val targetPath = uri

            val file = File(targetPath)

            if (!file.exists() || file.isDirectory) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "File not found")
            }

            return try {
                val mimeType = getCustomMimeType(targetPath)
                val fis = FileInputStream(file)
                newFixedLengthResponse(Response.Status.OK, mimeType, fis, file.length().toLong())
            } catch (e: Exception) {
                newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Error reading file")
            }
        }

        private fun getCustomMimeType(uri: String): String {
            return when {
                uri.endsWith(".m3u8", ignoreCase = true) -> "application/vnd.apple.mpegurl"
                uri.endsWith(".ts", ignoreCase = true) -> "video/mp2t"
                uri.endsWith(".mp4", ignoreCase = true) -> "video/mp4"
                uri.endsWith(".key", ignoreCase = true) -> "application/octet-stream"
                else -> MIME_PLAINTEXT
            }
        }
    }
}
