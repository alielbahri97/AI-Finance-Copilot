package com.ballastmoney.android.data.bank

import com.ballastmoney.android.data.repository.jsonEngine
import com.ballastmoney.android.data.repository.testHttpClient
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.junit.jupiter.api.Assertions.assertTrue

/**
 * The scaffolding the bank tests share.
 *
 * The store is faked rather than exercised through DataStore because DataStore
 * needs a `Context`, and a unit test that stands up Android to check "did the
 * reference survive being asked for twice" is testing the wrong thing. That the
 * interface exists at all is what makes this possible.
 */
class FakePendingBankConnectionStore(
    initial: PendingBankConnection? = null,
) : PendingBankConnectionStore {

    private val state = MutableStateFlow(initial)

    /** How many times the record has been cleared, for the tests that care. */
    var clearCount: Int = 0
        private set

    override val pending: Flow<PendingBankConnection?> = state.asStateFlow()

    override suspend fun current(): PendingBankConnection? = state.value

    override suspend fun save(pending: PendingBankConnection) {
        state.value = pending
    }

    override suspend fun clear() {
        clearCount++
        state.value = null
    }
}

/**
 * A JSON response, for the engines that inspect the request before answering.
 *
 * The content type has to be set every time: `ContentNegotiation` will not decode
 * a body that does not declare one, and the failure reads as "no transformation
 * found" rather than as whatever the test meant to check.
 */
fun MockRequestHandleScope.jsonResponse(
    body: String,
    status: HttpStatusCode = HttpStatusCode.OK,
) = respond(
    content = body,
    status = status,
    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
)

/** A repository whose `finalize` answers with one canned body. */
fun bankRepository(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
    BankConnectionRepository(testHttpClient(jsonEngine(body, status)))

/** `finalize` succeeds with two accounts. */
fun connectingRepository() = bankRepository(
    """
    {"connection":{"id":"conn-ing","provider":"gocardless","status":"CONNECTED",
     "institutionName":"ING","accounts":[{"id":"acc-1"},{"id":"acc-2"}]}}
    """.trimIndent(),
)

/** `finalize` answers `404 NOT_FOUND`: not (yet) approved. */
fun notFoundRepository() = bankRepository(
    """{"error":"No pending bank connection matches that reference.","code":"NOT_FOUND"}""",
    HttpStatusCode.NotFound,
)

/**
 * A repository that must not be called.
 *
 * Used where the assertion is that no request happened at all — a poll with
 * nothing outstanding, for instance. It answers a `500` so a test that does reach
 * it fails on its own assertion rather than passing quietly.
 */
fun failingRepository() = bankRepository(
    """{"error":"this call should never have been made"}""",
    HttpStatusCode.InternalServerError,
)

/**
 * Asserts a value is of a particular type and hands it back typed.
 *
 * The alternative at every call site is a cast plus a null check, which is three
 * lines of noise around one assertion, or a `!!`, which this codebase does not
 * use.
 */
inline fun <reified T> assertIs(value: Any?): T {
    assertTrue(value is T, "expected ${T::class.simpleName} but got $value")
    return value as T
}
