package com.ballastmoney.android.data.repository

import com.ballastmoney.android.data.remote.ApiRoutes
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.BallastApiError
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * "On `401`, refresh the access token and retry once."
 *
 * The contract's own sentence, and the three things that can go wrong with it:
 * not retrying at all, retrying with the stale token, and retrying forever. The
 * last is the expensive one — a dead refresh token with an unbounded retry is a
 * loop that empties a battery against a session the user has to re-enter by
 * hand — so every test here asserts on the number of requests the engine saw,
 * not only on the result.
 */
class AuthRetryTest {

    @Test
    @DisplayName("a 401 is refreshed once and the retry carries the new token")
    fun refreshesOnceAndRetries() = runTest {
        val authorizations = mutableListOf<String?>()
        var served = 0
        val engine = MockEngine { request ->
            authorizations += request.headers[HttpHeaders.Authorization]
            served++
            if (served == 1) unauthorized() else okBootstrap()
        }
        val tokens = FakeAccessTokenProvider(initialToken = "stale-token", refreshedToken = "fresh-token")

        val result = BallastApi(testHttpClient(engine, tokenProvider = tokens)).bootstrap()

        assertTrue(result.isSuccess, "the retry did not succeed: ${result.exceptionOrNull()}")
        assertEquals(1, tokens.refreshCount, "the token was refreshed more than once")
        assertEquals(
            listOf("Bearer stale-token", "Bearer fresh-token"),
            authorizations,
            "the retry did not carry the refreshed token",
        )
    }

    @Test
    @DisplayName("a refresh that yields nothing leaves the original 401 as Unauthenticated")
    fun deadRefreshTokenSurfacesAsUnauthenticated() = runTest {
        var served = 0
        val engine = MockEngine {
            served++
            unauthorized()
        }
        val tokens = FakeAccessTokenProvider(initialToken = "stale-token", refreshedToken = null)

        val result = BallastApi(testHttpClient(engine, tokenProvider = tokens)).bootstrap()

        assertFailureIs<BallastApiError.Unauthenticated>(result.exceptionOrNull())
        assertEquals(1, tokens.refreshCount)
        // The refresh produced nothing, so there was no point sending the same
        // token a second time.
        assertEquals(1, served, "the request was replayed with a token that does not exist")
    }

    @Test
    @DisplayName("a request with no token at all is not retried: a 401 is the expected answer")
    fun anonymousRequestIsNotRetried() = runTest {
        val authorizations = mutableListOf<String?>()
        var served = 0
        val engine = MockEngine { request ->
            authorizations += request.headers[HttpHeaders.Authorization]
            served++
            unauthorized()
        }
        val tokens = FakeAccessTokenProvider(initialToken = null, refreshedToken = "fresh-token")

        val result = BallastApi(testHttpClient(engine, tokenProvider = tokens)).bootstrap()

        assertFailureIs<BallastApiError.Unauthenticated>(result.exceptionOrNull())
        assertEquals(0, tokens.refreshCount, "a signed-out client tried to refresh a session it does not have")
        assertEquals(1, served)
        assertEquals(1, authorizations.size)
        assertNull(authorizations.first(), "an Authorization header was sent with no token to put in it")
    }

    @Test
    @DisplayName("the selected workspace travels as a hint on every request")
    fun workspaceHeaderIsSent() = runTest {
        val workspaces = mutableListOf<String?>()
        val engine = MockEngine { request ->
            workspaces += request.headers[ApiRoutes.Headers.WORKSPACE]
            okBootstrap()
        }
        val tokens = FakeAccessTokenProvider(initialToken = "token", refreshedToken = "token")

        val api = BallastApi(
            testHttpClient(
                engine,
                tokenProvider = tokens,
                workspaceSelection = FakeWorkspaceSelection("ws_9c1f"),
            ),
        )
        api.bootstrap()

        assertEquals(listOf("ws_9c1f"), workspaces)
    }
}

private fun MockRequestHandleScope.unauthorized() = respond(
    content = """{"error":"Unauthorized"}""",
    status = HttpStatusCode.Unauthorized,
    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
)

private fun MockRequestHandleScope.okBootstrap() = respond(
    content = BOOTSTRAP_BODY,
    status = HttpStatusCode.OK,
    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
)

/** The smallest payload `BootstrapDto` accepts; every other field has a default. */
private const val BOOTSTRAP_BODY = """
    {
      "profile": { "id": "u_1", "email": "ada@ballastmoney.com", "fullName": "Ada Lovelace", "currency": "EUR" },
      "workspaces": [ { "id": "ws_9c1f", "name": "Ballast", "type": "BUSINESS", "role": "OWNER" } ],
      "workspace": { "id": "ws_9c1f", "name": "Ballast", "type": "BUSINESS", "edition": "business", "currency": "EUR" },
      "membership": { "role": "OWNER", "memberId": "m_1", "permissions": ["view_transactions"] },
      "entitlements": { "planId": "FREE", "planName": "Free", "edition": "business" },
      "onboardingComplete": true
    }
"""
