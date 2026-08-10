package com.ballastmoney.android.data.bank

import com.ballastmoney.android.data.remote.ApiRoutes
import com.ballastmoney.android.data.remote.BallastApiError
import com.ballastmoney.android.data.repository.assertFailureIs
import com.ballastmoney.android.data.repository.jsonEngine
import com.ballastmoney.android.data.repository.testHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The three GoCardless calls, against a mock engine.
 *
 * These are wire-contract tests rather than logic tests: the whole flow rests on
 * `institutions` coping with a shape the route is free to change, on `link`
 * yielding a reference and an expiry, and on `finalize` being safe to call twice.
 * All three are things only a real payload can confirm.
 */
class BankConnectionRepositoryTest {

    @Test
    @DisplayName("institutions reads a bare array, which is what the provider function returns")
    fun institutionsFromBareArray() = runTest {
        val body = """
            [
              {"id":"ING_INGBNL2A","name":"ING","bic":"INGBNL2A","logo":"https://cdn/ing.png"},
              {"id":"ABNAMRO_ABNANL2A","name":"ABN AMRO"}
            ]
        """.trimIndent()

        val banks = repository(jsonEngine(body)).institutions("NL").getOrNull().orEmpty()

        assertEquals(listOf("ING", "ABN AMRO"), banks.map { it.name })
        assertEquals("INGBNL2A", banks.first().bic)
        assertEquals("https://cdn/ing.png", banks.first().logoUrl)
    }

    @Test
    @DisplayName("institutions reads the wrapped object the route actually answers with")
    fun institutionsFromWrappedObject() = runTest {
        val body = """
            {"institutions":[{"id":"REVOLUT_REVOGB21","name":"Revolut","transactionTotalDays":730}]}
        """.trimIndent()

        val banks = repository(jsonEngine(body)).institutions("GB").getOrNull().orEmpty()

        assertEquals(listOf("Revolut"), banks.map { it.name })
    }

    @Test
    @DisplayName("a renamed wrapper key still yields a list rather than an empty picker")
    fun institutionsFromUnknownWrapperKey() = runTest {
        val body = """{"results":[{"id":"BUNQ_BUNQNL2A","name":"bunq"}]}"""

        val banks = repository(jsonEngine(body)).institutions("NL").getOrNull().orEmpty()

        assertEquals(listOf("bunq"), banks.map { it.name })
    }

    @Test
    @DisplayName("a payload holding no list at all is empty, not a failure")
    fun institutionsFromSomethingElseEntirely() = runTest {
        val result = repository(jsonEngine("""{"ok":true}""")).institutions("NL")

        assertEquals(emptyList<BankInstitution>(), result.getOrNull())
    }

    @Test
    @DisplayName("a bank with no name falls back to its id, because a blank row cannot be tapped")
    fun institutionsWithoutNames() = runTest {
        val body = """[{"id":"SANDBOXFINANCE_SFIN0000","name":""},{"id":"","name":"Ghost"}]"""

        val banks = repository(jsonEngine(body)).institutions("NL").getOrNull().orEmpty()

        // The entry with no id is dropped: there would be nothing to post.
        assertEquals(listOf("SANDBOXFINANCE_SFIN0000"), banks.map { it.name })
    }

    @Test
    @DisplayName("institutions sends the country, without which the route answers 400")
    fun institutionsSendsCountry() = runTest {
        var requestedCountry: String? = null
        val engine = MockEngine { request ->
            requestedCountry = request.url.parameters["country"]
            jsonResponse("[]")
        }

        repository(engine).institutions(" nl ")

        assertEquals("NL", requestedCountry)
    }

    @Test
    @DisplayName("link yields the reference and expiry the resume path depends on")
    fun linkParsesResponse() = runTest {
        val body = """
            {
              "link":"https://ob.gocardless.com/psd2/start/abc/ING_INGBNL2A",
              "requisitionId":"req_123",
              "reference":"ballast-ws1-1786000000000-6f2a1b",
              "institutionId":"ING_INGBNL2A",
              "expiresAt":"2026-08-10T08:00:00.000Z"
            }
        """.trimIndent()

        val start = repository(jsonEngine(body))
            .startLink(institutionId = "ING_INGBNL2A", institutionName = "ING")
            .getOrNull()

        assertEquals("https://ob.gocardless.com/psd2/start/abc/ING_INGBNL2A", start?.consentUrl)
        assertEquals("ballast-ws1-1786000000000-6f2a1b", start?.pending?.reference)
        assertEquals("ING_INGBNL2A", start?.pending?.institutionId)
        // Carried from the picker, not from the response, which has no name in it.
        assertEquals("ING", start?.pending?.institutionName)
        assertEquals(Instant.parse("2026-08-10T08:00:00Z"), start?.pending?.expiresAt)
    }

    @Test
    @DisplayName("link posts institutionId, the field name the server's schema validates")
    fun linkSendsInstitutionId() = runTest {
        var sentBody: String? = null
        val engine = MockEngine { request ->
            sentBody = (request.body as? TextContent)?.text
            jsonResponse("""{"link":"https://ob.example/start","reference":"ref-1"}""")
        }

        repository(engine).startLink(institutionId = "BUNQ_BUNQNL2A", institutionName = "bunq")

        assertTrue(
            sentBody?.contains("\"institutionId\":\"BUNQ_BUNQNL2A\"") == true,
            "the link body did not carry institutionId: $sentBody",
        )
    }

    @Test
    @DisplayName("a link response with no expiry still gets one, so polling can end")
    fun linkWithoutExpiryFallsBackToThirtyMinutes() = runTest {
        val before = Instant.now()
        val body = """{"link":"https://ob.example/start","reference":"ref-2"}"""

        val start = repository(jsonEngine(body))
            .startLink(institutionId = "X_BANK", institutionName = "X Bank")
            .getOrNull()

        val expiresAt = start?.pending?.expiresAt
        assertTrue(
            expiresAt != null && expiresAt.isAfter(before),
            "no expiry was derived, which would poll for ever: $expiresAt",
        )
        // Falls back to the institution asked for, since the response named none.
        assertEquals("X_BANK", start?.pending?.institutionId)
    }

    @Test
    @DisplayName("finalize returns the connection and how many accounts came with it")
    fun finalizeSucceeds() = runTest {
        val result = repository(jsonEngine(FINALIZED_BODY)).finalizeConnection("ref-3")

        val connection = result.getOrNull()
        assertEquals("conn-ing", connection?.id)
        assertEquals("ING", connection?.institutionName)
        assertEquals("CONNECTED", connection?.status)
        assertEquals(2, connection?.accountCount)
    }

    @Test
    @DisplayName("finalize is safe to repeat: a second call is the same connection, not an error")
    fun finalizeIsIdempotent() = runTest {
        var calls = 0
        val engine = MockEngine {
            calls++
            jsonResponse(FINALIZED_BODY)
        }
        val repo = repository(engine)

        val first = repo.finalizeConnection("ref-4")
        val second = repo.finalizeConnection("ref-4")

        assertEquals(2, calls)
        assertEquals(first.getOrNull(), second.getOrNull())
        assertNull(second.exceptionOrNull())
    }

    @Test
    @DisplayName("404 NOT_FOUND is the not-yet-approved answer, typed as NotFound")
    fun finalizeNotFound() = runTest {
        val failure = repository(
            jsonEngine(
                """{"error":"No pending bank connection matches that reference.","code":"NOT_FOUND"}""",
                HttpStatusCode.NotFound,
            ),
        ).finalizeConnection("ref-5").exceptionOrNull()

        val error = assertFailureIs<BallastApiError.NotFound>(failure)
        assertEquals("NOT_FOUND", error.code)
    }

    @Test
    @DisplayName("410 is the expired or disconnected answer, typed as Expired")
    fun finalizeGone() = runTest {
        val failure = repository(
            jsonEngine(
                """{"error":"The bank approval took too long and the attempt expired. Connect again."}""",
                HttpStatusCode.Gone,
            ),
        ).finalizeConnection("ref-6").exceptionOrNull()

        val error = assertFailureIs<BallastApiError.Expired>(failure)
        assertTrue(error.message.contains("expired"), "the server's reason was lost")
    }

    @Test
    @DisplayName("502 is the never-completed-at-the-bank answer, typed as Server 502")
    fun finalizeBadGateway() = runTest {
        val failure = repository(
            jsonEngine(
                """{"error":"The bank approval was not completed."}""",
                HttpStatusCode.BadGateway,
            ),
        ).finalizeConnection("ref-7").exceptionOrNull()

        val error = assertFailureIs<BallastApiError.Server>(failure)
        assertEquals(502, error.status)
    }

    @Test
    @DisplayName("every call goes to the route in ApiRoutes rather than a path spelled out here")
    fun routesAreTheContractedOnes() = runTest {
        val paths = mutableListOf<String>()
        val engine = MockEngine { request ->
            paths += request.url.encodedPath
            jsonResponse(FINALIZED_BODY)
        }

        repository(engine).finalizeConnection("ref-8")

        assertEquals(listOf("/${ApiRoutes.GOCARDLESS_FINALIZE}"), paths)
    }

    private fun repository(engine: MockEngine) = BankConnectionRepository(testHttpClient(engine))

    private companion object {
        const val FINALIZED_BODY = """
            {
              "connection": {
                "id":"conn-ing",
                "provider":"gocardless",
                "status":"CONNECTED",
                "institutionName":"ING",
                "accounts":[
                  {"id":"acc-1","mask":"1234","currency":"EUR"},
                  {"id":"acc-2","mask":"9876","currency":"EUR"}
                ]
              }
            }
        """
    }
}
