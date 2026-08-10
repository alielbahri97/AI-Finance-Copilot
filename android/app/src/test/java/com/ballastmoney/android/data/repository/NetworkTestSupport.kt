package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.domain.AccessTokenProvider
import com.ballastmoney.android.core.domain.WorkspaceSelection
import com.ballastmoney.android.data.remote.BallastAuth
import com.ballastmoney.android.data.remote.BallastJson
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.junit.jupiter.api.Assertions.assertTrue

/**
 * The scaffolding the network tests share.
 *
 * The client built here mirrors `CoreModule.provideHttpClient` in the two
 * things these tests are about — `expectSuccess`, so a non-2xx becomes the
 * exception `apiCall` classifies, and the shared [BallastJson] configuration —
 * and deliberately omits the rest.
 *
 * `HttpRequestRetry` in particular is left out: it retries `5xx` twice, so a
 * test that asserts "one request produced one error" would see three, and a
 * test counting token refreshes would be measuring the retry plugin instead of
 * the auth plugin. Timeouts and logging are omitted because they have nothing
 * to say against an in-memory engine.
 */
fun testHttpClient(
    engine: MockEngine,
    tokenProvider: AccessTokenProvider? = null,
    workspaceSelection: WorkspaceSelection = FakeWorkspaceSelection(),
): HttpClient = HttpClient(engine) {
    expectSuccess = true

    install(ContentNegotiation) { json(BallastJson) }

    // Only installed when a test is about authentication: without it there is
    // no `Authorization` header and no retry, which is exactly what the
    // error-mapping tests want to observe.
    // The parameter is named `tokenProvider` rather than `tokens` on purpose:
    // inside the config lambda the receiver's own `tokens` property would
    // shadow an identically named parameter, and the assignment would silently
    // become a self-assignment of an uninitialised `lateinit`.
    if (tokenProvider != null) {
        install(BallastAuth) {
            tokens = tokenProvider
            workspace = workspaceSelection
        }
    }

    // A trailing slash, so the routes in `ApiRoutes` — which carry no leading
    // slash — resolve relative to the base rather than replacing it. Getting
    // this wrong in production would send every request to the wrong path, so
    // the tests reproduce the arrangement rather than using absolute URLs.
    defaultRequest { url(TEST_BASE_URL) }
}

const val TEST_BASE_URL = "https://ballast.test/"

/**
 * Answers every request with the same body.
 *
 * The content type is always set, because `ContentNegotiation` refuses to
 * decode a body that does not declare one — a response without it fails as
 * "no transformation found" rather than as whatever the test meant to assert.
 */
fun jsonEngine(
    body: String,
    status: HttpStatusCode = HttpStatusCode.OK,
    contentType: ContentType = ContentType.Application.Json,
): MockEngine = MockEngine {
    respond(
        content = body,
        status = status,
        headers = headersOf(HttpHeaders.ContentType, contentType.toString()),
    )
}

/**
 * An [AccessTokenProvider] that counts refreshes.
 *
 * The count is the assertion in the retry tests: the contract says a `401` is
 * refreshed and retried **once**, and "once" is only observable from here.
 */
class FakeAccessTokenProvider(
    initialToken: String?,
    private val refreshedToken: String?,
) : AccessTokenProvider {

    var refreshCount: Int = 0
        private set

    private var token: String? = initialToken

    override suspend fun currentAccessToken(): String? = token

    override suspend fun refreshAccessToken(): String? {
        refreshCount++
        token = refreshedToken
        return refreshedToken
    }
}

/** In-memory [WorkspaceSelection]; the header it feeds is a hint and grants nothing. */
class FakeWorkspaceSelection(initial: String? = null) : WorkspaceSelection {

    private val state = MutableStateFlow(initial)

    override val selectedWorkspaceId: Flow<String?> = state.asStateFlow()

    override suspend fun currentWorkspaceId(): String? = state.value

    override suspend fun select(workspaceId: String?) {
        state.value = workspaceId
    }
}

/**
 * Asserts a failure is of a particular kind and hands it back typed.
 *
 * JUnit's own `assertNotNull` returns nothing, so the alternative at every call
 * site is a `!!` or an unchecked cast written out longhand. This keeps both out
 * of the tests and puts the offending value in the message when it fails.
 */
inline fun <reified T : Throwable> assertFailureIs(failure: Throwable?): T {
    assertTrue(failure is T, "expected ${T::class.simpleName} but got $failure")
    return failure as T
}
