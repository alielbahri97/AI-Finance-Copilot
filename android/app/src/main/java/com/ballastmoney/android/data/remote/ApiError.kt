package com.ballastmoney.android.data.remote

import com.ballastmoney.android.core.model.Permission
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The error envelope every failing endpoint returns.
 *
 * `error` is always present and is written to be shown to a person. `code` is
 * the machine-readable discriminator and is only present on some responses, so
 * the status code is always part of the decision.
 */
@Serializable
internal data class ApiErrorBody(
    val error: String? = null,
    val code: String? = null,
    val feature: String? = null,
    val plan: String? = null,
    val permission: String? = null,
    @SerialName("workspaces")
    val workspaces: List<String>? = null,
)

/**
 * A failure from the Ballast API, classified by what the caller should *do*
 * about it rather than by HTTP status.
 *
 * The distinction matters because three of these are not errors in the usual
 * sense and must not be rendered as one:
 *
 *  - [Paywalled] is a `402`. It is the plan speaking, not a fault, and the
 *    right response is an upgrade prompt.
 *  - [Forbidden] is a `403`: the member is missing a permission, so the
 *    surface should be hidden rather than retried.
 *  - [WrongEdition] is a `404` with `WRONG_EDITION`: in this edition the
 *    feature is not a thing that could be granted at all.
 *
 * Only [Network] and [Server] are worth retrying automatically.
 */
sealed class BallastApiError(
    /** Safe to show to the user. The server writes these for humans. */
    override val message: String,
    override val cause: Throwable? = null,
) : Exception(message, cause) {

    /** No usable session or token. The client refreshes and retries once. */
    class Unauthenticated(message: String = "Your session has expired. Sign in again.") :
        BallastApiError(message)

    /** `402`. The plan does not include this, or its quota is spent. */
    data class Paywalled(
        override val message: String,
        val reason: PaywallReason,
        /** Feature key the server named, e.g. `integrations`. */
        val feature: String? = null,
        /** Plan the workspace is on, as the server spelled it. */
        val plan: String? = null,
    ) : BallastApiError(message)

    /** `403`. Authenticated, but the member lacks a permission. */
    data class Forbidden(
        override val message: String,
        /** Null when the server named a permission this client does not know. */
        val permission: Permission? = null,
        val rawPermission: String? = null,
    ) : BallastApiError(message)

    /** `404` with `WRONG_EDITION`. Hide the surface; do not retry. */
    data class WrongEdition(
        override val message: String,
        val feature: String? = null,
    ) : BallastApiError(message)

    /** `404` without `WRONG_EDITION`. The thing genuinely is not there. */
    data class NotFound(override val message: String, val code: String? = null) :
        BallastApiError(message)

    /** `400`. The message names the offending field. A client bug. */
    data class BadRequest(override val message: String, val code: String? = null) :
        BallastApiError(message)

    /** `409`. A conflict the user has to resolve before this can succeed. */
    data class Conflict(
        override val message: String,
        val code: String? = null,
        val workspaces: List<String>? = null,
    ) : BallastApiError(message)

    /** `410`. Gone for good — an expired bank consent attempt, typically. */
    data class Expired(override val message: String) : BallastApiError(message)

    /** `429`. [retryAfterSeconds] comes from the `Retry-After` header. */
    data class RateLimited(
        override val message: String,
        val retryAfterSeconds: Long? = null,
    ) : BallastApiError(message)

    /** `5xx`. Worth one retry; the detail is server-side only. */
    data class Server(
        override val message: String,
        val status: Int,
    ) : BallastApiError(message)

    /** The request never got an answer: no connectivity, timeout, DNS. */
    data class Network(
        override val message: String = "Could not reach Ballast. Check your connection.",
        override val cause: Throwable? = null,
    ) : BallastApiError(message, cause)

    /**
     * The response arrived but could not be understood. Distinct from
     * [Server] so a wire-contract regression is visible as itself in logs
     * rather than hiding among genuine server faults.
     */
    data class Malformed(
        override val message: String = "Ballast sent something this version of the app could not read.",
        override val cause: Throwable? = null,
    ) : BallastApiError(message, cause)
}

/** Why a `402` was returned. Both are paywalls, with different copy. */
enum class PaywallReason {
    /** `UPGRADE_REQUIRED`: the plan never included this. */
    UPGRADE_REQUIRED,

    /** `LIMIT_REACHED`: included, but this period's allowance is used up. */
    LIMIT_REACHED,
}

/** Machine-readable `code` values the contract defines. */
internal object ApiErrorCodes {
    const val UPGRADE_REQUIRED = "UPGRADE_REQUIRED"
    const val LIMIT_REACHED = "LIMIT_REACHED"
    const val FORBIDDEN = "FORBIDDEN"
    const val WRONG_EDITION = "WRONG_EDITION"
    const val RATE_LIMITED = "RATE_LIMITED"
    const val NOT_FOUND = "NOT_FOUND"
}
