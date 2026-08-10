package com.ballastmoney.android.ui.accounts

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.ConnectedAccount
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Every string and number this screen shows, worked out without touching
 * Compose.
 *
 * Keeping it here rather than inline in the composables is what makes the copy
 * checkable: "1 accounts" is the kind of thing that only ever gets caught by
 * reading the function that produces it.
 */

/** Days before consent expiry at which the renew warning appears, as on the web. */
const val CONSENT_WARNING_DAYS: Long = 14

fun pluralAccounts(count: Int): String = if (count == 1) "1 account" else "$count accounts"

fun pluralDays(count: Long): String = if (count == 1L) "1 day" else "$count days"

fun pluralConnections(count: Int): String =
    if (count == 1) "1 connection" else "$count connections"

/** Colour intent for a status dot or badge, resolved against the theme by the UI. */
enum class StatusTone { SUCCESS, WARNING, DESTRUCTIVE, MUTED, INFO }

data class ProviderTileStatus(val label: String, val tone: StatusTone)

/**
 * The tile summarises every connection to the provider: the worst status wins,
 * because a broken bank must not hide behind a healthy one, and the count only
 * appears once there is more than one.
 */
fun providerTileStatus(
    provider: IntegrationProvider,
    connections: List<IntegrationConnection>,
    locked: Boolean,
): ProviderTileStatus {
    if (locked) return ProviderTileStatus("Business plan", StatusTone.MUTED)
    if (!provider.configured) return ProviderTileStatus("Needs setup", StatusTone.MUTED)
    if (connections.isEmpty()) return ProviderTileStatus("Available", StatusTone.INFO)

    val count = connections.size
    val suffix = if (count > 1) " · $count" else ""
    return when {
        connections.any { it.status == ConnectionStatus.ERROR } ->
            ProviderTileStatus("Error$suffix", StatusTone.DESTRUCTIVE)

        connections.any { it.status == ConnectionStatus.EXPIRED } ->
            ProviderTileStatus("Reconnect$suffix", StatusTone.WARNING)

        else -> ProviderTileStatus(
            if (count > 1) "$count connected" else "Connected",
            StatusTone.SUCCESS,
        )
    }
}

data class ConnectionStatusBadge(val label: String, val tone: StatusTone)

fun connectionStatusBadge(status: ConnectionStatus): ConnectionStatusBadge = when (status) {
    ConnectionStatus.CONNECTED -> ConnectionStatusBadge("Connected", StatusTone.SUCCESS)
    ConnectionStatus.ERROR -> ConnectionStatusBadge("Error", StatusTone.DESTRUCTIVE)
    ConnectionStatus.EXPIRED -> ConnectionStatusBadge("Expired", StatusTone.WARNING)
}

/** The label under an account row: mask, then name, then a last resort. */
fun accountLabel(account: ConnectedAccount): String =
    account.mask?.takeIf { it.isNotBlank() }
        ?: account.name?.takeIf { it.isNotBlank() }
        ?: "Account"

data class CurrencyTotal(
    val currency: String,
    val amount: BigDecimal,
    val accounts: Int,
)

/**
 * What one connection contributes to the cash total, or null when it cannot be
 * stated as a single figure.
 *
 * There is no FX rate on the client, so a connection holding a EUR and a USD
 * account gets no summed figure at all rather than a wrong one — the same call
 * the web page makes.
 */
fun countedBalance(connection: IntegrationConnection): CurrencyTotal? {
    val counted = connection.accounts.filter { it.includeInTotals && it.balance != null }
    if (counted.isEmpty()) return null
    val currencies = counted.map { it.currency.uppercase() }.toSet()
    if (currencies.size != 1) return null
    val total = counted.mapNotNull { it.balance }.fold(BigDecimal.ZERO, BigDecimal::add)
    return CurrencyTotal(currencies.first(), total, counted.size)
}

/** `"3 accounts · €1.234,56 counted"`, or null when the connection has none. */
fun connectionSummaryText(
    connection: IntegrationConnection,
    formatterFor: (String) -> MoneyFormatter,
): String? {
    if (connection.accounts.isEmpty()) return null
    val base = pluralAccounts(connection.accounts.size)
    val counted = countedBalance(connection) ?: return base
    return "$base · ${formatterFor(counted.currency).format(counted.amount)} counted"
}

/** Null for push-only providers, which have nothing to sync and so no line. */
fun lastSyncText(connection: IntegrationConnection, formatter: MoneyFormatter): String? {
    if (!connection.syncable) return null
    val lastSync = connection.lastSyncAt ?: return "Never synced"
    return "Last synced ${formatter.formatDateTime(lastSync)}"
}

sealed interface ConsentState {
    data object None : ConsentState

    /** Far enough out to be reassurance rather than a warning. */
    data class ValidUntil(val date: LocalDate) : ConsentState

    /** Inside the warning window; [daysLeft] is zero or negative on the day. */
    data class Expiring(val daysLeft: Long) : ConsentState
}

/**
 * Consent is only ever talked about on a live connection.
 *
 * An expired one says "access expired" already; adding "consent valid until 9
 * August" underneath would read as reassurance about a connection that has
 * stopped working. The renew warning is narrower still — it is for a healthy
 * connection that is about to lapse, which is the only case where renewing
 * early actually prevents an interruption.
 */
fun consentState(connection: IntegrationConnection, today: LocalDate): ConsentState {
    val expires = connection.consentExpiresAt ?: return ConsentState.None
    if (connection.status == ConnectionStatus.EXPIRED) return ConsentState.None
    val daysLeft = ChronoUnit.DAYS.between(today, expires)
    val warn = connection.status == ConnectionStatus.CONNECTED && daysLeft <= CONSENT_WARNING_DAYS
    return if (warn) ConsentState.Expiring(daysLeft) else ConsentState.ValidUntil(expires)
}

fun consentValidUntilText(date: LocalDate, formatter: MoneyFormatter): String =
    "Consent valid until ${formatter.formatDate(date)}"

fun consentWarningText(daysLeft: Long): String =
    if (daysLeft <= 0) {
        "Bank consent expires today"
    } else {
        "Bank consent expires in ${pluralDays(daysLeft)} — renew it to keep syncing " +
            "without interruption."
    }

/** Null once the window has passed, so a stale timestamp cannot scare anyone. */
fun rateLimitText(
    connection: IntegrationConnection,
    formatter: MoneyFormatter,
    now: Instant,
): String? {
    val until = connection.rateLimitedUntil ?: return null
    if (!until.isAfter(now)) return null
    return "Your bank's daily data limit was reached — syncing resumes automatically after " +
        "${formatter.formatDateTime(until)}."
}

/**
 * An expired connection always explains itself, whether or not the server left
 * a `lastError` behind: the reason is known from the status, and the reassuring
 * half of the sentence — that imported data survives — is the part people
 * actually need to read.
 */
fun connectionErrorText(connection: IntegrationConnection): String? = when {
    connection.status == ConnectionStatus.EXPIRED ->
        "Access expired — reconnect to resume syncing. Your imported data is unaffected."

    else -> connection.lastError?.takeIf { it.isNotBlank() }
}

/** The web hides "Sync now" on an expired connection: reconnecting comes first. */
fun canSyncNow(connection: IntegrationConnection): Boolean =
    connection.syncable && connection.status != ConnectionStatus.EXPIRED

data class AccountsTotals(
    /** One entry per distinct currency, workspace currency first. */
    val totals: List<CurrencyTotal>,
    val countedAccounts: Int,
    val excludedAccounts: Int,
) {
    val totalAccounts: Int get() = countedAccounts + excludedAccounts
    val hasAccounts: Boolean get() = totalAccounts > 0
}

/**
 * The aggregate card's numbers.
 *
 * Totals are kept per currency rather than added up, for the same reason a
 * single connection refuses to sum across currencies: converting without a rate
 * would be inventing a number.
 */
fun computeTotals(
    connections: List<IntegrationConnection>,
    workspaceCurrency: String,
): AccountsTotals {
    val accounts = connections.flatMap { it.accounts }
    val counted = accounts.filter { it.includeInTotals }
    val preferred = workspaceCurrency.uppercase()
    val totals = counted
        .filter { it.balance != null }
        .groupBy { it.currency.uppercase() }
        .map { (currency, group) ->
            CurrencyTotal(
                currency = currency,
                amount = group.mapNotNull { it.balance }.fold(BigDecimal.ZERO, BigDecimal::add),
                accounts = group.size,
            )
        }
        .sortedWith(
            compareByDescending<CurrencyTotal> { it.currency == preferred }
                .thenBy { it.currency },
        )
    return AccountsTotals(
        totals = totals,
        countedAccounts = counted.size,
        excludedAccounts = accounts.size - counted.size,
    )
}

/** `"4 accounts counted · 1 excluded"`. */
fun countedSummaryText(totals: AccountsTotals): String {
    val counted = "${pluralAccounts(totals.countedAccounts)} counted"
    return if (totals.excludedAccounts == 0) {
        counted
    } else {
        "$counted · ${totals.excludedAccounts} excluded"
    }
}

fun accountToggleMessage(includeInTotals: Boolean): String =
    if (includeInTotals) "Account counted in totals" else "Account excluded from totals"
