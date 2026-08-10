package com.ballastmoney.android.data.remote.dto

import com.ballastmoney.android.core.model.BigDecimalSerializer
import com.ballastmoney.android.core.model.InstantSerializer
import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant

/**
 * Wire shape for `GET /api/integrations`.
 *
 * [locked] is the one field worth reading the contract twice over. It means
 * "the plan does not include integrations", and it is deliberately **not** a
 * `402`: the grid still renders, behind an upgrade prompt, exactly as the web
 * app does. Treating it as an error would replace a working screen with a dead
 * one. The connect and sync endpoints are where the plan is actually enforced.
 */
@Serializable
data class IntegrationsResponseDto(
    val locked: Boolean = false,
    /** False when the server has no `INTEGRATION_ENCRYPTION_KEY`. */
    val encryptionConfigured: Boolean = true,
    val bankConnectionLimit: Int? = null,
    val currency: String? = null,
    val providers: List<ProviderCardDto> = emptyList(),
)

@Serializable
data class ProviderCardDto(
    val id: String,
    val name: String = "",
    val description: String = "",
    /** `banking`, `accounting` or `productivity`. */
    val category: String? = null,
    /** `transactions`, `invoices`, `email`, `notifications`, `calendar`. */
    val capabilities: List<String> = emptyList(),
    /** `redirect`, `oauth`, `webhook` — how a connection is established. */
    val flow: String? = null,
    /** False when the server is missing this provider's credentials. */
    val configured: Boolean = true,
    val missingEnvVars: List<String> = emptyList(),
    val requiredEnvVars: List<String> = emptyList(),
    /** False for push-only providers, which have no "Sync now". */
    val syncable: Boolean = true,
    val multiInstance: Boolean = false,
    val connections: List<ConnectionDto> = emptyList(),
)

@Serializable
data class ConnectionDto(
    val id: String,
    val provider: String = "",
    /** `CONNECTED`, `ERROR` or `EXPIRED`. */
    val status: String = "CONNECTED",
    val displayName: String? = null,
    val institutionName: String? = null,
    val institutionLogo: String? = null,
    /** Row heading the server derived: displayName, else institution, else provider. */
    val title: String? = null,
    @Serializable(with = InstantSerializer::class)
    val lastSyncAt: Instant? = null,
    val lastError: String? = null,
    /** "3 accounts", "Posting to #finance", a Xero organisation — when known. */
    val accountLabel: String? = null,
    val calendarEnabled: Boolean = false,
    /** Counts from the last sync run, so plain numbers rather than money. */
    val lastRunStats: Map<String, Int>? = null,
    /**
     * Open-banking consent expiry. A full timestamp on the wire; the domain
     * model keeps only the day, which is all the "expires in 12 days" warning
     * needs.
     */
    @Serializable(with = InstantSerializer::class)
    val consentExpiresAt: Instant? = null,
    /**
     * Latest still-future per-account throttle window the bank set. Information,
     * not an error: the connection is fine, the bank is just rationing.
     */
    @Serializable(with = InstantSerializer::class)
    val rateLimitedUntil: Instant? = null,
    val accounts: List<IntegrationAccountDto> = emptyList(),
    /** Sum of counted accounts, only when they agree on a currency. */
    @Serializable(with = BigDecimalSerializer::class)
    val includedBalance: BigDecimal? = null,
    val balanceCurrency: String? = null,
)

/**
 * One connected bank account.
 *
 * The balance is read from `lastBalance` with `balance` as a fallback. The two
 * spellings exist because `MOBILE_API.md`'s example for this endpoint shows
 * `balance`/`balanceAt` while the server's own serializer emits
 * `lastBalance`/`lastBalanceAt`. Accepting both costs two nullable fields and
 * means the client is right whichever one arrives, instead of silently showing
 * no balances at all if the guess went the wrong way.
 */
@Serializable
data class IntegrationAccountDto(
    val id: String,
    val name: String? = null,
    val mask: String? = null,
    /** What to show: mask, else name, else "Account". Derived server-side. */
    val label: String? = null,
    val currency: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val lastBalance: BigDecimal? = null,
    @Serializable(with = InstantSerializer::class)
    val lastBalanceAt: Instant? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal? = null,
    @Serializable(with = InstantSerializer::class)
    val balanceAt: Instant? = null,
    val includeInTotals: Boolean = true,
) {
    val effectiveBalance: BigDecimal? get() = lastBalance ?: balance
    val effectiveBalanceAt: Instant? get() = lastBalanceAt ?: balanceAt
}

// --- GoCardless bank connection -------------------------------------------

/** `GET /api/integrations/gocardless/institutions`. */
@Serializable
data class InstitutionDto(
    val id: String,
    val name: String = "",
    val bic: String? = null,
    val logo: String? = null,
    /** ISO country codes the bank serves. */
    val countries: List<String> = emptyList(),
    /** How many days of history the consent will cover. */
    val transactionTotalDays: Int? = null,
)

/**
 * The institutions route may answer with a bare array or with an object
 * wrapping one, so both are handled at the call site rather than guessed at.
 */
@Serializable
data class InstitutionsResponseDto(
    val institutions: List<InstitutionDto> = emptyList(),
)

/**
 * `POST /api/integrations/gocardless/link`.
 *
 * [reference] is the field that matters: it is what finalizes the connection,
 * and it must outlive the Custom Tab, the activity and — because users abandon
 * bank consent constantly — the process.
 */
@Serializable
data class BankLinkDto(
    val link: String,
    val requisitionId: String? = null,
    val reference: String,
    val institutionId: String? = null,
    /** Thirty minutes out. After this the attempt cannot be finalized. */
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant? = null,
)

@Serializable
data class FinalizeRequestDto(val reference: String)

/** `POST /api/integrations/gocardless/finalize`. Idempotent. */
@Serializable
data class FinalizeResponseDto(
    val connection: FinalizedConnectionDto,
)

@Serializable
data class FinalizedConnectionDto(
    val id: String,
    val provider: String = "gocardless",
    val status: String = "CONNECTED",
    val institutionName: String? = null,
    val institutionLogo: String? = null,
    val accounts: List<FinalizedAccountDto> = emptyList(),
)

/** Balances are usually null here; they arrive with the first sync. */
@Serializable
data class FinalizedAccountDto(
    val id: String,
    val externalAccountId: String? = null,
    val name: String? = null,
    val mask: String? = null,
    val currency: String? = null,
    val includeInTotals: Boolean = true,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal? = null,
    @Serializable(with = InstantSerializer::class)
    val balanceAt: Instant? = null,
)
