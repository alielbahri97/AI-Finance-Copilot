package com.ballastmoney.android.data.remote

import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.data.remote.dto.BillingSummaryDto
import com.ballastmoney.android.data.remote.dto.BootstrapDto
import com.ballastmoney.android.data.remote.dto.CategoriesResponseDto
import com.ballastmoney.android.data.remote.dto.DashboardResponseDto
import com.ballastmoney.android.data.remote.dto.IntegrationsResponseDto
import com.ballastmoney.android.data.remote.dto.ProfileResponseDto
import com.ballastmoney.android.data.remote.dto.SyncResultDto
import com.ballastmoney.android.data.remote.dto.TransactionsResponseDto
import com.ballastmoney.android.data.remote.dto.WorkspaceResponseDto
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Every call this app makes to the Ballast API, in one class.
 *
 * ### The convention, stated once
 *
 * **Every function here returns `Result` and none of them throw.** A failure is
 * always a [BallastApiError], because every call goes through [apiCall], which is
 * the single place in the app that knows what an HTTP status means. Callers never
 * see a `ResponseException`, an `IOException` or a `SerializationException`, and
 * never have to decide for themselves what a `402` is.
 *
 * The alternative — letting the typed exception propagate and wrapping it at each
 * repository — puts the same three-line `try` around every call site, and one of
 * them eventually forgets to rethrow `CancellationException`. [apiCall] already
 * gets that right.
 *
 * ### The workspace is named explicitly
 *
 * Every workspace-scoped call takes the workspace id and sends it as
 * `X-Ballast-Workspace` rather than relying on the selected-workspace fallback in
 * [BallastAuth]. During a workspace switch both values exist at once, and a
 * request that meant one workspace must not come back describing the other. A
 * null id — which only [bootstrap] and [profile] allow — leaves the header off and
 * lets the plugin, and then the server, pick the default. That is right for the
 * launch call, which runs before the client knows what workspaces exist.
 *
 * It does no caching, no mapping and no retrying: those belong to the
 * repositories, the mappers and the HTTP client respectively.
 */
@Singleton
class BallastApi @Inject constructor(
    private val client: HttpClient,
) {

    /** `GET /api/session/bootstrap`. The one call to make at launch. */
    suspend fun bootstrap(workspaceId: String? = null): Result<BootstrapDto> = apiCall {
        client.get(ApiRoutes.SESSION_BOOTSTRAP) { workspace(workspaceId) }.body()
    }

    suspend fun dashboard(workspaceId: String? = null): Result<DashboardResponseDto> = apiCall {
        client.get(ApiRoutes.DASHBOARD) { workspace(workspaceId) }.body()
    }

    /**
     * `GET /api/profile`. Carries `supportedCurrencies` and the edition
     * questionnaire, which the bootstrap payload does not.
     */
    suspend fun profile(workspaceId: String? = null): Result<ProfileResponseDto> = apiCall {
        client.get(ApiRoutes.PROFILE) { workspace(workspaceId) }.body()
    }

    /**
     * `GET /api/workspace`. What a member roster needs; `members` being null
     * rather than empty is how a Personal workspace says it has no team.
     */
    suspend fun workspace(workspaceId: String): Result<WorkspaceResponseDto> = apiCall {
        client.get(ApiRoutes.WORKSPACE) { workspace(workspaceId) }.body()
    }

    /** Requires `view_billing`; a member without it gets a `403`. */
    suspend fun billingSummary(workspaceId: String): Result<BillingSummaryDto> = apiCall {
        client.get(ApiRoutes.BILLING_SUMMARY) { workspace(workspaceId) }.body()
    }

    suspend fun categories(workspaceId: String): Result<CategoriesResponseDto> = apiCall {
        client.get(ApiRoutes.CATEGORIES) { workspace(workspaceId) }.body()
    }

    /**
     * `GET /api/integrations`.
     *
     * A locked plan answers `200` with `locked: true`, not `402`, so this is one
     * of the endpoints where a successful result still means "show the upgrade
     * prompt". See `IntegrationsResponseDto.toDomain`.
     */
    suspend fun integrations(workspaceId: String? = null): Result<IntegrationsResponseDto> =
        apiCall {
            client.get(ApiRoutes.INTEGRATIONS) { workspace(workspaceId) }.body()
        }

    /**
     * One page of the ledger.
     *
     * [page] is 1-based, as the contract requires. [pageSize] must already be one
     * of the three sizes the contract accepts — anything else is a documented
     * `400` — so the caller clamps it with
     * [com.ballastmoney.android.data.repository.allowedPageSize] rather than this
     * function quietly correcting a number the cache key was built from.
     *
     * `sort` and `dir` are always sent explicitly even when they match the
     * defaults, because the server's default sort is context-dependent: it is
     * `amount` rather than `date` when `category=uncategorized`. A client that
     * omitted them would get an ordering it did not ask for and could not
     * reproduce in its cache.
     *
     * Blank and null filters are omitted rather than sent empty. `?q=` and no `q`
     * mean the same thing to the server, and a parameter that is not there cannot
     * be mistyped into a `400`.
     */
    suspend fun transactions(
        workspaceId: String? = null,
        query: TransactionQuery,
        page: Int,
        pageSize: Int,
    ): Result<TransactionsResponseDto> = apiCall {
        client.get(ApiRoutes.TRANSACTIONS) {
            workspace(workspaceId)
            query.search.trim().takeIf { it.isNotEmpty() }?.let {
                parameter(ApiRoutes.Params.SEARCH, it)
            }
            query.type?.let { parameter(ApiRoutes.Params.TYPE, it.name) }
            // Passed through verbatim, including the `uncategorized` literal,
            // which the endpoint understands as its own filter.
            query.categoryId?.let { parameter(ApiRoutes.Params.CATEGORY, it) }
            query.importBatchId?.let { parameter(ApiRoutes.Params.IMPORT_BATCH, it) }
            query.from?.let { parameter(ApiRoutes.Params.FROM, it.toDayParam()) }
            query.to?.let { parameter(ApiRoutes.Params.TO, it.toDayParam()) }
            // Plain decimals, not money strings: `min` and `max` are coerced to
            // numbers by the server's schema. `toPlainString` so a bound never
            // leaves in scientific notation, which `z.coerce.number` rejects.
            query.minAmount?.let { parameter(ApiRoutes.Params.MIN_AMOUNT, it.toPlainString()) }
            query.maxAmount?.let { parameter(ApiRoutes.Params.MAX_AMOUNT, it.toPlainString()) }
            parameter(ApiRoutes.Params.SORT, query.sort.toWire())
            parameter(ApiRoutes.Params.DIRECTION, query.direction.toWire())
            parameter(ApiRoutes.Params.PAGE, page)
            parameter(ApiRoutes.Params.SIZE, pageSize)
        }.body()
    }

    suspend fun createTransaction(
        workspaceId: String,
        draft: TransactionDraft,
    ): Result<Unit> = apiCall {
        client.post(ApiRoutes.TRANSACTIONS) {
            workspace(workspaceId)
            jsonBody { putDraft(draft) }
        }
        Unit
    }

    suspend fun updateTransaction(
        workspaceId: String,
        transactionId: String,
        draft: TransactionDraft,
    ): Result<Unit> = apiCall {
        client.patch(ApiRoutes.transaction(transactionId)) {
            workspace(workspaceId)
            jsonBody { putDraft(draft) }
        }
        Unit
    }

    /**
     * Bulk recategorise. A null [categoryId] clears the category, and the server's
     * schema takes an explicit null for that — so a null is sent rather than the
     * field omitted, since an absent field would mean "leave it alone".
     */
    suspend fun setTransactionCategory(
        workspaceId: String,
        transactionIds: List<String>,
        categoryId: String?,
    ): Result<Unit> = apiCall {
        client.post(ApiRoutes.TRANSACTIONS_BULK) {
            workspace(workspaceId)
            jsonBody {
                put("action", "setCategory")
                put("ids", JsonArray(transactionIds.map(::JsonPrimitive)))
                put("categoryId", categoryId?.let(::JsonPrimitive) ?: JsonNull)
            }
        }
        Unit
    }

    suspend fun deleteTransactions(
        workspaceId: String,
        transactionIds: List<String>,
    ): Result<Unit> = apiCall {
        client.post(ApiRoutes.TRANSACTIONS_BULK) {
            workspace(workspaceId)
            jsonBody {
                put("action", "delete")
                put("ids", JsonArray(transactionIds.map(::JsonPrimitive)))
            }
        }
        Unit
    }

    /**
     * Asks one connection to sync now.
     *
     * The route is `/api/integrations/{provider}/sync` and the connection is named
     * in the body. Naming it matters: each connection has its own consent, cursor
     * and rate-limit budget with the bank, so a workspace with two banks must be
     * able to sync the one the user tapped rather than whichever the server picks.
     */
    suspend fun sync(
        workspaceId: String,
        providerId: String,
        connectionId: String,
    ): Result<SyncResultDto> = apiCall {
        client.post(ApiRoutes.providerSync(providerId)) {
            workspace(workspaceId)
            jsonBody { put("connectionId", connectionId) }
        }.body()
    }

    /** Flips one bank account in or out of the aggregated cash total. */
    suspend fun setAccountIncludedInTotals(
        workspaceId: String,
        providerId: String,
        connectionId: String,
        accountId: String,
        includeInTotals: Boolean,
    ): Result<Unit> = apiCall {
        client.patch(ApiRoutes.providerOptions(providerId)) {
            workspace(workspaceId)
            jsonBody {
                put("connectionId", connectionId)
                put(
                    "account",
                    JsonObject(
                        mapOf(
                            "id" to JsonPrimitive(accountId),
                            "includeInTotals" to JsonPrimitive(includeInTotals),
                        ),
                    ),
                )
            }
        }
        Unit
    }

    /**
     * Removes one connection. The workspace's other connections to the same
     * provider are untouched, and transactions already imported stay — they are
     * ordinary rows in the ledger now.
     */
    suspend fun disconnect(
        workspaceId: String,
        providerId: String,
        connectionId: String,
    ): Result<Unit> = apiCall {
        client.post(ApiRoutes.providerDisconnect(providerId)) {
            workspace(workspaceId)
            jsonBody { put("connectionId", connectionId) }
        }
        Unit
    }
}

/**
 * Names the workspace this request is about.
 *
 * A null id leaves the header off, which lets [BallastAuth] fall back to the
 * selected workspace. That is the right behaviour for the bootstrap call, which
 * runs before the client knows which workspaces exist.
 */
private fun HttpRequestBuilder.workspace(workspaceId: String?) {
    workspaceId?.let { header(ApiRoutes.Headers.WORKSPACE, it) }
}

/**
 * A JSON request body built by hand.
 *
 * These three request bodies have one or two fields each and no domain type of
 * their own, so a `@Serializable` class per endpoint would be three classes that
 * exist to be written once. The `options` route validates with a `.strict()`
 * schema, which rejects any field it does not know, so building the object
 * explicitly is also the safest way to be sure nothing extra is sent.
 */
private fun HttpRequestBuilder.jsonBody(build: JsonObjectBuilder.() -> Unit) {
    contentType(ContentType.Application.Json)
    setBody(buildJsonObject(build))
}

/**
 * The fields the create and update schemas share.
 *
 * Two details are not obvious and both come from the server's Zod schema:
 *
 *  - `amount` is `z.coerce.number()`, so the money string a `BigDecimal` produces
 *    is accepted and coerced exactly. It is sent as a string anyway, because
 *    that is what every other amount on this wire is and because a JSON number
 *    would go through a double on the way.
 *  - `date` is `z.coerce.date()`. It is sent as a full UTC-midnight timestamp
 *    rather than as `YYYY-MM-DD`, so the day the user picked is the day stored no
 *    matter which timezone either end is in — the same convention the API uses
 *    when it sends a date back.
 *
 * `categoryId` and `counterparty` are sent as explicit nulls when empty rather
 * than omitted, because on the update route an absent field means "leave this
 * alone" and the user clearing a category means "remove it".
 */
private fun JsonObjectBuilder.putDraft(draft: TransactionDraft) {
    put("type", draft.type.name)
    put("amount", draft.amount.toPlainString())
    put("description", draft.description.trim())
    put("date", "${draft.date}T00:00:00.000Z")
    put("categoryId", draft.categoryId?.let(::JsonPrimitive) ?: JsonNull)
    put(
        "counterparty",
        draft.counterparty?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull,
    )
}

/**
 * The `sort` values the endpoint accepts, spelled out rather than derived from
 * [Enum.name].
 *
 * Renaming an enum constant is a local refactor; renaming a wire value is a
 * breaking change. An exhaustive `when` is what forces the two to be considered
 * separately, and it stops a constant rename from silently changing the ordering
 * every cached query key was built with.
 */
internal fun TransactionSortKey.toWire(): String = when (this) {
    TransactionSortKey.DATE -> "date"
    TransactionSortKey.DESCRIPTION -> "description"
    TransactionSortKey.CATEGORY -> "category"
    TransactionSortKey.AMOUNT -> "amount"
}

internal fun SortDirection.toWire(): String = when (this) {
    SortDirection.ASC -> "asc"
    SortDirection.DESC -> "desc"
}
