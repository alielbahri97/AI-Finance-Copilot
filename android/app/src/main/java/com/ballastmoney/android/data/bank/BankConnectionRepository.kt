package com.ballastmoney.android.data.bank

import com.ballastmoney.android.data.remote.ApiRoutes
import com.ballastmoney.android.data.remote.BallastJson
import com.ballastmoney.android.data.remote.apiCall
import com.ballastmoney.android.data.remote.dto.BankLinkDto
import com.ballastmoney.android.data.remote.dto.FinalizeRequestDto
import com.ballastmoney.android.data.remote.dto.FinalizeResponseDto
import com.ballastmoney.android.data.remote.dto.InstitutionDto
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The three calls the GoCardless bank-connection flow is made of.
 *
 * It follows the write half of the repository contract in `core/domain`: every
 * function is `suspend` and returns [Result], with failures already classified
 * as a `BallastApiError` by [apiCall]. There is no read half and no cache — a
 * consent link is minted per call and a reference is redeemed once, so there is
 * nothing here that a `Flow` of cached state would describe. The connection that
 * comes out the far end is cached, by `GET /api/integrations`, which another
 * repository owns.
 *
 * This deliberately does not implement a `core/domain` interface. Those describe
 * screens' data; this describes one handshake, and inventing an interface for a
 * single implementation would only add a file.
 */
@Singleton
class BankConnectionRepository @Inject constructor(
    private val client: HttpClient,
) {

    /**
     * The banks available in [country], for the picker.
     *
     * The country is mandatory: the endpoint answers `400` without
     * `?country=XX` and its cache is per country, because the list is different
     * in every one and is far too long to serve unfiltered.
     *
     * The list arrives unsorted apart from a sandbox institution the server puts
     * first when one is configured, so ordering is left to the caller — the
     * picker wants alphabetical, and pre-sorting here would throw away the fact
     * that the first entry was deliberately placed.
     */
    suspend fun institutions(country: String): Result<List<BankInstitution>> = apiCall {
        val payload = client.get(ApiRoutes.GOCARDLESS_INSTITUTIONS) {
            parameter(COUNTRY_PARAM, country.trim().uppercase())
        }.bodyAsText()
        parseInstitutions(payload)
    }

    /**
     * Mints a consent link for [institutionId].
     *
     * [institutionName] is not sent anywhere — it is only folded into the
     * returned [PendingBankConnection] so the record on disk can say which bank
     * the user went off to approve. The response carries no name of its own.
     */
    suspend fun startLink(
        institutionId: String,
        institutionName: String,
    ): Result<BankLinkStart> = apiCall {
        val response: BankLinkDto = client.post(ApiRoutes.GOCARDLESS_LINK) {
            contentType(ContentType.Application.Json)
            setBody(BankLinkRequestBody(institutionId = institutionId))
        }.body()
        BankLinkStart(
            consentUrl = response.link,
            pending = PendingBankConnection(
                reference = response.reference,
                institutionId = response.institutionId ?: institutionId,
                institutionName = institutionName,
                // The contract always sends an expiry. If a proxy or a future
                // server drops it, a local thirty minutes is the documented
                // lifetime and is far better than a record with no way to
                // decide the attempt is over, which would poll for ever.
                expiresAt = response.expiresAt ?: Instant.now().plus(DEFAULT_LINK_LIFETIME),
            ),
        )
    }

    /**
     * Redeems a reference.
     *
     * Safe to call repeatedly with the same reference: the endpoint is
     * idempotent and returns the connection it already made rather than a second
     * one. That is what makes the app's resume behaviour correct without it
     * having to know whether the web callback got there first — which it cannot
     * know, because the bank redirects to the web callback and the app never
     * sees the result.
     *
     * Named `finalizeConnection` rather than `finalize` to stay clear of
     * `Object.finalize`, which is a confusing thing to have on a repository even
     * when the signatures do not collide.
     */
    suspend fun finalizeConnection(reference: String): Result<ConnectedBank> = apiCall {
        val response: FinalizeResponseDto = client.post(ApiRoutes.GOCARDLESS_FINALIZE) {
            contentType(ContentType.Application.Json)
            setBody(FinalizeRequestDto(reference = reference))
        }.body()
        val connection = response.connection
        ConnectedBank(
            id = connection.id,
            institutionName = connection.institutionName,
            status = connection.status,
            accountCount = connection.accounts.size,
        )
    }
}

/**
 * The body of `POST /link`.
 *
 * A type of its own rather than a `JsonObject` built by hand, so the field name
 * the server validates against — `institutionId`, matching its Zod schema — is
 * declared once and cannot be misspelled at a call site.
 */
@Serializable
private data class BankLinkRequestBody(val institutionId: String)

/**
 * Reads the institutions payload whether it arrived as a bare array or wrapped
 * in an object.
 *
 * The route as written answers `{ "institutions": [...] }`, but `MOBILE_API.md`
 * does not freeze that shape and the underlying provider function returns a bare
 * array, so both are accepted. An unfamiliar wrapper key is handled too, by
 * taking the object's first array-valued property: that costs nothing and turns
 * a rename on the server from "the picker is empty for everyone on the old
 * build" into a non-event.
 *
 * Anything that is neither an array nor an object holding one yields an empty
 * list rather than throwing. A bank list is not the sort of payload worth
 * failing a screen over — the picker's empty state already says there is nothing
 * to choose from, and the alternative is a crash-shaped error for a country
 * GoCardless does not cover.
 *
 * Internal rather than private so the two shapes can be tested directly, without
 * a round trip through the HTTP client for what is a parsing decision.
 */
internal fun parseInstitutions(rawJson: String): List<BankInstitution> {
    val element = BallastJson.parseToJsonElement(rawJson)
    val array = when (element) {
        is JsonArray -> element
        is JsonObject -> element[INSTITUTIONS_KEY] as? JsonArray
            ?: element.values.firstNotNullOfOrNull { value -> value as? JsonArray }
        else -> null
    } ?: return emptyList()

    return BallastJson
        .decodeFromJsonElement(ListSerializer(InstitutionDto.serializer()), array)
        .filter { dto -> dto.id.isNotBlank() }
        .map { dto ->
            BankInstitution(
                id = dto.id,
                // An unnamed bank would render as a blank row, which is
                // untappable in practice. The id at least identifies it.
                name = dto.name.ifBlank { dto.id },
                logoUrl = dto.logo,
                bic = dto.bic,
            )
        }
}

private const val COUNTRY_PARAM = "country"
private const val INSTITUTIONS_KEY = "institutions"
private val DEFAULT_LINK_LIFETIME: Duration = Duration.ofMinutes(30)
