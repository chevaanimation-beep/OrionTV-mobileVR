package com.oriontv.vr

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import fi.iki.elonen.NanoHTTPD
import java.io.File
import java.io.FileInputStream

class LocalServerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var server: LocalWebServer? = null
    private val PORT = 18080
    private val TAG = "LocalServerModule"

    override fun getName(): String {
        return "LocalServerModule"
    }

    @ReactMethod
    fun startServer(promise: Promise) {
        try {
            if (server == null) {
                server = LocalWebServer(PORT)
                server?.start()
                Log.i(TAG, "[LocalServer] Server STARTED on port $PORT")
            } else if (server?.isAlive == false) {
                server?.start()
                Log.i(TAG, "[LocalServer] Server RESTARTED on port $PORT")
            } else {
                Log.i(TAG, "[LocalServer] Server already running on port $PORT")
            }
            val baseUrl = "http://127.0.0.1:$PORT"
            Log.i(TAG, "[LocalServer] Resolving promise with baseUrl: $baseUrl")
            promise.resolve(baseUrl)
        } catch (e: Exception) {
            Log.e(TAG, "[LocalServer] FAILED to start server: ${e.message}", e)
            promise.reject("SERVER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopServer() {
        Log.i(TAG, "[LocalServer] Stopping server")
        server?.stop()
        server = null
    }

    private inner class LocalWebServer(port: Int) : NanoHTTPD(port) {
        override fun serve(session: NanoHTTPD.IHTTPSession?): NanoHTTPD.Response {
            if (session == null) {
                Log.e(TAG, "[LocalServer] serve() called with null session")
                return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.BAD_REQUEST, NanoHTTPD.MIME_PLAINTEXT, "Bad Request")
            }

            val uri = session.uri
            val method = session.method
            Log.i(TAG, "[LocalServer] --> $method $uri")

            // URI from NanoHTTPD is URL-decoded path, e.g. /data/user/0/.../local.m3u8
            // Decode %XX sequences just in case
            val decodedPath = try {
                java.net.URLDecoder.decode(uri, "UTF-8")
            } catch (e: Exception) {
                uri
            }

            val file = File(decodedPath)
            Log.i(TAG, "[LocalServer] Resolved file path: ${file.absolutePath}")
            Log.i(TAG, "[LocalServer] File exists: ${file.exists()}, isDir: ${file.isDirectory}, size: ${if (file.exists() && !file.isDirectory) file.length() else -1}")

            if (!file.exists()) {
                // List parent directory to help diagnose path issues
                val parent = file.parentFile
                if (parent != null && parent.exists()) {
                    val siblings = parent.list()?.take(20)?.joinToString(", ") ?: "(empty)"
                    Log.w(TAG, "[LocalServer] Parent dir '${parent.absolutePath}' exists. Contents: $siblings")
                } else {
                    Log.w(TAG, "[LocalServer] Parent dir '${parent?.absolutePath}' does NOT exist either")
                }
                Log.e(TAG, "[LocalServer] 404 Not Found: $decodedPath")
                return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.NOT_FOUND,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "File not found: $decodedPath"
                )
            }

            if (file.isDirectory) {
                Log.e(TAG, "[LocalServer] 400 Path is a directory: $decodedPath")
                return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "Path is a directory"
                )
            }

            return try {
                val mimeType = getCustomMimeType(decodedPath)
                Log.i(TAG, "[LocalServer] 200 OK, mimeType=$mimeType, size=${file.length()}")
                val fis = FileInputStream(file)
                NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, mimeType, fis, file.length())
            } catch (e: Exception) {
                Log.e(TAG, "[LocalServer] 500 Error reading file: ${e.message}", e)
                NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.INTERNAL_ERROR,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "Error reading file: ${e.message}"
                )
            }
        }

        private fun getCustomMimeType(path: String): String {
            return when {
                path.endsWith(".m3u8", ignoreCase = true) -> "application/vnd.apple.mpegurl"
                path.endsWith(".ts", ignoreCase = true) -> "video/mp2t"
                path.endsWith(".mp4", ignoreCase = true) -> "video/mp4"
                path.endsWith(".key", ignoreCase = true) -> "application/octet-stream"
                else -> NanoHTTPD.MIME_PLAINTEXT
            }
        }
    }
}
