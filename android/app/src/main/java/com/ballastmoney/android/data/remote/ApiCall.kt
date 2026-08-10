package com.ballastmoney.android.data.remote

import com.ballastmoney.android.core.model.Permission
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.ResponseException
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import java.io.IOException

/**
 * Runs a network call and returns [Result], with every failure already
 * classified as a [BallastApiError].
 *
 * Repositories return `Result` by contract, so this is the single place that
 * knows about HTTP at all. Doing the classification here rather than at each
 * call site is what keeps `402` from being handled as a crash in one screen and
 * as a paywall in another.
 *
 * [CancellationException] is rethrown rather than captured. Swallowing it would
 * turn a cancelled coroutine — a user leaving a screen — into a spurious error
 * state, and would break structured concurrency besides.
 */
suspend fun <T> apiCall(block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (failure: Throwable) {
        Result.failure(failure.toBallastApiError())
    }

/** Classifies a thrown exception. Already-typed errors pass through. */
suspend fun Throwable.toBallastApiError(): BallastApiError = when (this) {
    is BallastApiError -> this
    is ResponseException -> response.toBallastApiError()
    is HttpRequestTimeoutException -> BallastApiError.Network(
        "Ballast took too long to answer. Try again.",
        this,
    )
    is IOException -> BallastApiError.Network(cause = this)
    is SerializationException -> BallastApiError.Malformed(cause = this)
    else -> BallastApiError.Malformed(
        message = message ?: "Something went wrong.",
        cause = this,
    )
}

/**
 * Maps a non-2xx response onto the contract in `MOBILE_API.md`, section 4.
 *
 * The body is read defensively: a proxy or a crashed route can answer with HTML
 * instead of the documented envelope, and that must still produce a sensible
 * error rather than a parse failure masquerading as one.
 */
internal suspend fun HttpResponse.toBallastApiError(): BallastApiError {
    val body = readErrorBody()
    val message = body?.error?.takeIf { it.isNotBlank() }
    val code = body?.code

    return when (status.value) {
        400 -> BallastApiError.BadRequest(message ?: "That request was not valid.", code)

        401 -> BallastApiError.Unauthenticated(
            message ?: "Your session has expired. Sign in again.",
        )

        402 -> BallastApiError.Paywalled(
            message = message ?: "Your plan does not include this.",
            // Anything other than an explicit LIMIT_REACHED is treated as
            // needing an upgrade, which is the safer of the two to guess: it
            // offers a way forward, where "quota spent" only says to wait.
            reason = if (code == ApiErrorCodes.LIMIT_REACHED) {
                PaywallReason.LIMIT_REACHED
            } else {
                PaywallReason.UPGRADE_REQUIRED
            },
            feature = body?.feature,
            plan = body?.plan,
        )

        403 -> BallastApiError.Forbidden(
            message = message ?: "You do not have permission to do that.",
            permission = body?.permission?.let(::permissionOrNull),
            rawPermission = body?.permission,
        )

        404 -> if (code == ApiErrorCodes.WRONG_EDITION) {
            BallastApiError.WrongEdition(
                message ?: "That is not part of this workspace.",
                body?.feature,
            )
        } else {
            BallastApiError.NotFound(message ?: "Not found.", code)
        }

        409 -> BallastApiError.Conflict(
            message ?: "That conflicts with something else.",
            code,
            body?.workspaces,
        )

        410 -> BallastApiError.Expired(
            message ?: "That is no longer available.",
        )

        429 -> BallastApiError.RateLimited(
            message = message ?: "Too many requests. Try again shortly.",
            retryAfterSeconds = headers[HttpHeaders.RetryAfter]?.toLongOrNull(),
        )

        else -> if (status.value >= 500) {
            BallastApiError.Server(
                message ?: "Ballast had a problem. Try again shortly.",
                status.value,
            )
        } else {
            BallastApiError.Malformed(
                message ?: "Unexpected response (${status.value}).",
            )
        }
    }
}

private suspend fun HttpResponse.readErrorBody(): ApiErrorBody? =
    runCatching { body<ApiErrorBody>() }.getOrElse {
        // Not the documented envelope. Fall back to the raw text, but only if
        // it is short enough to plausibly be a message rather than an HTML
        // error page, which would be nonsense in a snackbar.
        runCatching {
            val text = bodyAsText().trim()
            if (text.isNotEmpty() && text.length <= MAX_PLAIN_ERROR_LENGTH && !text.startsWith("<")) {
                ApiErrorBody(error = text)
            } else {
                null
            }
        }.getOrNull()
    }

/**
 * A permission the server names but this build does not know is not an error:
 * the API can ship ahead of the app. It degrades to a null [Permission] with
 * the raw string kept for logging.
 */
private fun permissionOrNull(raw: String): Permission? =
    Permission.entries.firstOrNull { permission ->
        permissionWireName(permission) == raw
    }

/**
 * The `@SerialName` of a [Permission], derived without reflection: the enum's
 * serial names are the SCREAMING_CASE constant lowercased, which is the rule
 * `src/lib/workspace/permissions.ts` follows.
 */
internal fun permissionWireName(permission: Permission): String =
    permission.name.lowercase()

private const val MAX_PLAIN_ERROR_LENGTH = 300
