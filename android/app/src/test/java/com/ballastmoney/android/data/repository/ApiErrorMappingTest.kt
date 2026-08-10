package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.BallastApiError
import com.ballastmoney.android.data.remote.PaywallReason
import io.ktor.client.engine.mock.MockEngine
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
 * Section 4 of `MOBILE_API.md`, one status at a time.
 *
 * The classification is worth this much test surface because three of these are
 * not failures at all in the sense a user would recognise. A `402` is the plan
 * speaking and wants an upgrade prompt; a `403` means hide the surface; a `404`
 * with `WRONG_EDITION` means the feature is not a thing that could be granted
 * here. Rendering any of the three as "something went wrong, try again" is a
 * worse bug than a crash, because the user follows the advice and it never
 * works.
 *
 * Every case goes through `GET /api/dashboard`, since the mapping is per status
 * and not per route.
 */
class ApiErrorMappingTest {

    private val workspaceId = "ws_9c1f"

    @Test
    @DisplayName("400 keeps the field-naming message the server wrote")
    fun badRequest() = runTest {
        val failure = failureFor(
            HttpStatusCode.BadRequest,
            """{"error":"size must be one of 25, 50, 100"}""",
        )

        val error = assertFailureIs<BallastApiError.BadRequest>(failure)
        assertEquals("size must be one of 25, 50, 100", error.message)
    }

    @Test
    @DisplayName("401 is Unauthenticated, and without a token there is nothing to retry")
    fun unauthorized() = runTest {
        val failure = failureFor(HttpStatusCode.Unauthorized, """{"error":"Unauthorized"}""")

        val error = assertFailureIs<BallastApiError.Unauthenticated>(failure)
        assertEquals("Unauthorized", error.message)
    }

    @Test
    @DisplayName("402 UPGRADE_REQUIRED carries the feature and plan an upgrade prompt needs")
    fun upgradeRequired() = runTest {
        val failure = failureFor(
            HttpStatusCode.PaymentRequired,
            """{"error":"Integrations are a Business feature.","code":"UPGRADE_REQUIRED","feature":"integrations","plan":"FREE"}""",
        )

        val error = assertFailureIs<BallastApiError.Paywalled>(failure)
        assertEquals(PaywallReason.UPGRADE_REQUIRED, error.reason)
        assertEquals("integrations", error.feature)
        assertEquals("FREE", error.plan)
    }

    @Test
    @DisplayName("402 LIMIT_REACHED is a different paywall: included, but spent")
    fun limitReached() = runTest {
        val failure = failureFor(
            HttpStatusCode.PaymentRequired,
            """{"error":"You have used this month's imports.","code":"LIMIT_REACHED","feature":"csvImports","plan":"PRO"}""",
        )

        val error = assertFailureIs<BallastApiError.Paywalled>(failure)
        assertEquals(PaywallReason.LIMIT_REACHED, error.reason)
        assertEquals("csvImports", error.feature)
    }

    @Test
    @DisplayName("403 resolves the permission the server named")
    fun forbiddenWithKnownPermission() = runTest {
        val failure = failureFor(
            HttpStatusCode.Forbidden,
            """{"error":"You cannot edit transactions.","code":"FORBIDDEN","permission":"edit_transactions"}""",
        )

        val error = assertFailureIs<BallastApiError.Forbidden>(failure)
        assertEquals(Permission.EDIT_TRANSACTIONS, error.permission)
        assertEquals("edit_transactions", error.rawPermission)
    }

    @Test
    @DisplayName("403 naming a permission this build does not know degrades instead of crashing")
    fun forbiddenWithUnknownPermission() = runTest {
        val failure = failureFor(
            HttpStatusCode.Forbidden,
            """{"error":"Not allowed.","code":"FORBIDDEN","permission":"manage_forecast_scenarios"}""",
        )

        val error = assertFailureIs<BallastApiError.Forbidden>(failure)
        // The API can ship ahead of the app; an unrecognised permission is
        // version skew, and the raw string is kept for the log.
        assertNull(error.permission)
        assertEquals("manage_forecast_scenarios", error.rawPermission)
    }

    @Test
    @DisplayName("404 WRONG_EDITION is not the same failure as a plain 404")
    fun wrongEditionIsDistinctFromNotFound() = runTest {
        val wrongEdition = assertFailureIs<BallastApiError.WrongEdition>(
            failureFor(
                HttpStatusCode.NotFound,
                """{"error":"Budgets are not part of a Business workspace.","code":"WRONG_EDITION","feature":"budgets"}""",
            ),
        )
        assertEquals("budgets", wrongEdition.feature)

        val notFound = assertFailureIs<BallastApiError.NotFound>(
            failureFor(HttpStatusCode.NotFound, """{"error":"No such workspace."}"""),
        )
        assertNull(notFound.code)
    }

    @Test
    @DisplayName("409 keeps the code and the workspaces that block the request")
    fun conflict() = runTest {
        val failure = failureFor(
            HttpStatusCode.Conflict,
            """{"error":"You are the last owner of a shared workspace.","code":"SOLE_OWNER","workspaces":["ws_1","ws_2"]}""",
        )

        val error = assertFailureIs<BallastApiError.Conflict>(failure)
        assertEquals("SOLE_OWNER", error.code)
        assertEquals(listOf("ws_1", "ws_2"), error.workspaces)
    }

    @Test
    @DisplayName("410 is gone for good, not worth a retry")
    fun expired() = runTest {
        val failure = failureFor(
            HttpStatusCode.Gone,
            """{"error":"That bank consent attempt has expired."}""",
        )

        val error = assertFailureIs<BallastApiError.Expired>(failure)
        assertEquals("That bank consent attempt has expired.", error.message)
    }

    @Test
    @DisplayName("429 reads Retry-After, which is the only way to know how long to wait")
    fun rateLimited() = runTest {
        val engine = MockEngine {
            respond(
                content = """{"error":"Too many requests.","code":"RATE_LIMITED"}""",
                status = HttpStatusCode.TooManyRequests,
                headers = headersOf(
                    HttpHeaders.ContentType to listOf(ContentType.Application.Json.toString()),
                    HttpHeaders.RetryAfter to listOf("30"),
                ),
            )
        }

        val failure = failureFrom(engine)

        val error = assertFailureIs<BallastApiError.RateLimited>(failure)
        assertEquals(30L, error.retryAfterSeconds ?: 0L)
    }

    @Test
    @DisplayName("500 keeps the safe message and the status")
    fun serverError() = runTest {
        val failure = failureFor(
            HttpStatusCode.InternalServerError,
            """{"error":"Something went wrong on our side."}""",
        )

        val error = assertFailureIs<BallastApiError.Server>(failure)
        assertEquals(500, error.status)
        assertEquals("Something went wrong on our side.", error.message)
    }

    @Test
    @DisplayName("an HTML error page from a proxy degrades to a sentence, not to markup")
    fun htmlErrorPage() = runTest {
        val html = "<html><head><title>502 Bad Gateway</title></head><body><h1>502</h1></body></html>"
        val engine = jsonEngine(html, HttpStatusCode.BadGateway, ContentType.Text.Html)

        val failure = failureFrom(engine)

        val error = assertFailureIs<BallastApiError.Server>(failure)
        assertEquals(502, error.status)
        assertTrue(
            !error.message.contains("<"),
            "markup reached the message, which would be shown to a user: ${error.message}",
        )
    }

    @Test
    @DisplayName("a short plain-text body is still worth showing")
    fun plainTextErrorBody() = runTest {
        val engine = jsonEngine(
            "Service temporarily unavailable",
            HttpStatusCode.ServiceUnavailable,
            ContentType.Text.Plain,
        )

        val failure = failureFrom(engine)

        val error = assertFailureIs<BallastApiError.Server>(failure)
        assertEquals(503, error.status)
        assertEquals("Service temporarily unavailable", error.message)
    }

    private suspend fun failureFor(status: HttpStatusCode, body: String): Throwable? =
        failureFrom(jsonEngine(body, status))

    /**
     * Every case goes through `BallastApi` rather than calling the classifier
     * directly, because the classifier is only correct in context: it has to read
     * the body of a response the engine has already produced, once, and through
     * the same content negotiation the app uses.
     */
    private suspend fun failureFrom(engine: MockEngine): Throwable? =
        BallastApi(testHttpClient(engine)).dashboard(workspaceId).exceptionOrNull()
}
