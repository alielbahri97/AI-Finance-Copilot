package com.ballastmoney.android.data.remote

import com.ballastmoney.android.core.domain.AccessTokenProvider
import com.ballastmoney.android.core.domain.WorkspaceSelection
import io.ktor.client.plugins.api.Send
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode

class BallastAuthConfig {
    lateinit var tokens: AccessTokenProvider
    lateinit var workspace: WorkspaceSelection
}

/**
 * Attaches identity to every request, and renews it once when the server says
 * the token is no longer good.
 *
 * Two headers, on every call:
 *
 *  - `Authorization: Bearer <supabase access token>`
 *  - `X-Ballast-Workspace: <workspace id>`, when one is selected
 *
 * ### Why the `Send` hook rather than `onRequest`
 *
 * `onRequest` can add a header but cannot re-run a request. Refreshing on a
 * `401` needs both, and [Send] is the one hook that sits around the whole
 * send-and-receive so it can call `proceed` a second time. It also runs
 * *before* response validation, so the `401` is visible here as a status rather
 * than having already been turned into an exception by `expectSuccess`.
 *
 * ### Exactly once
 *
 * A single retry, deliberately. The contract says a `401` means "refresh and
 * retry once"; if the retry is also refused then the refresh token is dead too
 * and looping would just spend battery on a session the user has to re-enter by
 * hand. If the refresh yields no token, the original `401` is returned
 * untouched and surfaces as [BallastApiError.Unauthenticated].
 *
 * Requests that carry no token to begin with are not retried either — an
 * anonymous call getting a `401` is the expected answer, not a stale token.
 */
val BallastAuth = createClientPlugin("BallastAuth", ::BallastAuthConfig) {
    val tokens = pluginConfig.tokens
    val workspace = pluginConfig.workspace

    on(Send) { request ->
        val token = tokens.currentAccessToken()
        if (token != null) {
            request.headers[HttpHeaders.Authorization] = "Bearer $token"
        }
        workspace.currentWorkspaceId()?.let { id ->
            request.headers[ApiRoutes.Headers.WORKSPACE] = id
        }

        val call = proceed(request)
        if (call.response.status != HttpStatusCode.Unauthorized || token == null) {
            return@on call
        }

        val refreshed = tokens.refreshAccessToken() ?: return@on call
        request.headers[HttpHeaders.Authorization] = "Bearer $refreshed"
        proceed(request)
    }
}
