package com.ballastmoney.android.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/** Shape of `GET /api/integrations`. */
@Serializable
data class IntegrationsOverview(
    val providers: List<IntegrationProvider>,
    val connections: List<IntegrationConnection>,
    /** Set when the workspace's plan does not include integrations at all. */
    val lockedReason: LockedReason? = null,
)

@Serializable
enum class LockedReason {
    /** Plan gate: the web app shows "Integrations are a Business feature". */
    UPGRADE_REQUIRED,

    /** The connection limit for the current plan is already used up. */
    LIMIT_REACHED,
}

@Serializable
data class IntegrationProvider(
    val id: String,
    val displayName: String,
    val category: ProviderCategory,
    val capabilities: Set<ProviderCapability>,
    /** Null means this provider is push-only and never polls. */
    val syncIntervalHours: Int? = null,
    /** Whether more than one connection to this provider is allowed. */
    val multiInstance: Boolean = false,
    /**
     * False when the server is missing the provider's credentials. The web app
     * shows "Needs setup" and an administrator guide rather than a dead button.
     */
    val configured: Boolean = true,
)

@Serializable
enum class ProviderCategory {
    @SerialName("banking")
    BANKING,

    @SerialName("accounting")
    ACCOUNTING,

    @SerialName("productivity")
    PRODUCTIVITY,
}

@Serializable
enum class ProviderCapability {
    @SerialName("transactions")
    TRANSACTIONS,

    @SerialName("invoices")
    INVOICES,

    @SerialName("email")
    EMAIL,

    @SerialName("notifications")
    NOTIFICATIONS,

    @SerialName("calendar")
    CALENDAR,
}

@Serializable
data class IntegrationConnection(
    val id: String,
    val providerId: String,
    /** displayName, falling back to institution then provider name. */
    val title: String,
    val status: ConnectionStatus,
    @Serializable(with = InstantSerializer::class)
    val lastSyncAt: Instant? = null,
    val lastError: String? = null,
    /**
     * Open-banking consent expiry. GoCardless consents lapse after 90 days and
     * the web app starts warning at 14 days out.
     */
    @Serializable(with = LocalDateSerializer::class)
    val consentExpiresAt: LocalDate? = null,
    /** Set while the bank's daily data limit is exhausted. */
    @Serializable(with = InstantSerializer::class)
    val rateLimitedUntil: Instant? = null,
    val accounts: List<ConnectedAccount> = emptyList(),
    /** False for push-only providers, which have no "Sync now". */
    val syncable: Boolean = true,
)

@Serializable
enum class ConnectionStatus {
    CONNECTED,
    ERROR,
    EXPIRED,
}

@Serializable
data class ConnectedAccount(
    val id: String,
    val name: String? = null,
    /** Masked account number, e.g. `••4321`. */
    val mask: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal? = null,
    val currency: String,
    val includeInTotals: Boolean = true,
)

/** Result of a manual "Sync now", used only to phrase the confirmation. */
data class SyncOutcome(
    val connectionTitle: String,
    val stats: Map<String, Int> = emptyMap(),
)
