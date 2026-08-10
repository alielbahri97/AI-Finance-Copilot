package com.ballastmoney.android.ui.accounts

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.ConnectedAccount
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.LockedReason
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.PlanLimits
import com.ballastmoney.android.core.model.ProviderCapability
import com.ballastmoney.android.core.model.ProviderCategory
import com.ballastmoney.android.core.model.WorkspaceType
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * Fixtures for the previews in this package, and nothing else.
 *
 * They live here rather than in `data/` on purpose: these are not fakes the app
 * can run on, they are the six pictures worth looking at while building the
 * screen. The provider list is the real registry — same ids, same names, same
 * sync intervals — so a preview cannot flatter a layout that real data would
 * break.
 */
internal object AccountsPreviewData {

    /** Fixed clock, so a consent countdown reads the same in every screenshot. */
    val today: LocalDate = LocalDate.parse("2026-08-10")
    val now: Instant = Instant.parse("2026-08-10T07:30:00Z")

    val gocardless = provider(
        id = "gocardless",
        displayName = "GoCardless Bank Account Data",
        category = ProviderCategory.BANKING,
        capabilities = setOf(ProviderCapability.TRANSACTIONS),
        multiInstance = true,
    )
    val plaid = provider(
        id = "plaid",
        displayName = "Plaid",
        category = ProviderCategory.BANKING,
        capabilities = setOf(ProviderCapability.TRANSACTIONS),
        multiInstance = true,
    )
    val tink = provider(
        id = "tink",
        displayName = "Tink",
        category = ProviderCategory.BANKING,
        capabilities = setOf(ProviderCapability.TRANSACTIONS),
    )

    val businessProviders: List<IntegrationProvider> = listOf(
        gocardless,
        plaid,
        tink,
        provider(
            id = "quickbooks",
            displayName = "QuickBooks",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
        ),
        provider(
            id = "xero",
            displayName = "Xero",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
        ),
        provider(
            id = "exact",
            displayName = "Exact Online",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
        ),
        provider(
            id = "gmail",
            displayName = "Gmail",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.EMAIL),
        ),
        provider(
            id = "outlook",
            displayName = "Outlook",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.EMAIL),
        ),
        provider(
            id = "google-calendar",
            displayName = "Google Calendar",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.CALENDAR),
            syncIntervalHours = 24,
        ),
        provider(
            id = "slack",
            displayName = "Slack",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.NOTIFICATIONS),
            syncIntervalHours = null,
        ),
        provider(
            id = "teams",
            displayName = "Microsoft Teams",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.NOTIFICATIONS),
            syncIntervalHours = null,
        ),
    )

    /** Healthy, three accounts, one of them deliberately left out of totals. */
    val ing = IntegrationConnection(
        id = "conn-ing",
        providerId = "gocardless",
        title = "ING",
        status = ConnectionStatus.CONNECTED,
        lastSyncAt = Instant.parse("2026-08-10T05:05:00Z"),
        consentExpiresAt = LocalDate.parse("2026-11-02"),
        accounts = listOf(
            account("acc-ing-1", mask = "••4321", balance = "8420.15"),
            account("acc-ing-2", mask = "••9876", balance = "1250.00"),
            account(
                "acc-ing-3",
                name = "Savings buffer",
                balance = "15000.00",
                includeInTotals = false,
            ),
        ),
    )

    /** A second bank, and a foreign-currency account to prove the formatter. */
    val revolut = IntegrationConnection(
        id = "conn-revolut",
        providerId = "plaid",
        title = "Revolut Business",
        status = ConnectionStatus.CONNECTED,
        lastSyncAt = Instant.parse("2026-08-09T18:40:00Z"),
        accounts = listOf(
            account("acc-rev-1", mask = "••1122", balance = "2310.40"),
            account("acc-rev-2", mask = "••7788", balance = "980.00", currency = "USD"),
            account("acc-rev-3", name = "Card float", balance = null),
        ),
    )

    val rabobankErrored = IntegrationConnection(
        id = "conn-rabo",
        providerId = "gocardless",
        title = "Rabobank",
        status = ConnectionStatus.ERROR,
        lastSyncAt = Instant.parse("2026-08-08T04:00:00Z"),
        lastError = "The bank rejected the last request (HTTP 429). We will try again shortly.",
        rateLimitedUntil = Instant.parse("2026-08-10T22:00:00Z"),
        accounts = listOf(account("acc-rabo-1", mask = "••5510", balance = "412.90")),
    )

    val bunqExpired = IntegrationConnection(
        id = "conn-bunq",
        providerId = "gocardless",
        title = "bunq",
        status = ConnectionStatus.EXPIRED,
        lastSyncAt = Instant.parse("2026-08-01T06:00:00Z"),
        lastError = "Requisition expired",
        consentExpiresAt = LocalDate.parse("2026-08-09"),
        accounts = listOf(account("acc-bunq-1", mask = "••3040", balance = "1875.25")),
    )

    /** Healthy, but the 90-day consent runs out inside the warning window. */
    val kbcExpiringConsent = IntegrationConnection(
        id = "conn-kbc",
        providerId = "gocardless",
        title = "KBC",
        status = ConnectionStatus.CONNECTED,
        lastSyncAt = Instant.parse("2026-08-10T05:10:00Z"),
        consentExpiresAt = LocalDate.parse("2026-08-15"),
        accounts = listOf(account("acc-kbc-1", mask = "••2244", balance = "6120.00")),
    )

    fun ready(
        connections: List<IntegrationConnection> = listOf(ing, revolut),
        providers: List<IntegrationProvider> = businessProviders,
        lockedReason: LockedReason? = null,
        edition: WorkspaceType = WorkspaceType.BUSINESS,
        currency: String = "EUR",
        syncingConnectionIds: Set<String> = emptySet(),
        pendingAccountToggles: Set<String> = emptySet(),
        isRefreshing: Boolean = false,
    ): AccountsUiState.Ready = AccountsUiState.Ready(
        edition = edition,
        overview = IntegrationsOverview(
            providers = providers,
            connections = connections,
            lockedReason = lockedReason,
        ),
        currency = currency,
        formatter = MoneyFormatter(currency),
        permissions = setOf(
            Permission.MANAGE_INTEGRATIONS,
            Permission.VIEW_TRANSACTIONS,
            Permission.VIEW_BILLING,
        ),
        limits = PlanLimits(integrationsEnabled = lockedReason == null, bankConnections = 3),
        syncingConnectionIds = syncingConnectionIds,
        pendingAccountToggles = pendingAccountToggles,
        isRefreshing = isRefreshing,
    )

    private fun provider(
        id: String,
        displayName: String,
        category: ProviderCategory,
        capabilities: Set<ProviderCapability>,
        syncIntervalHours: Int? = 6,
        multiInstance: Boolean = false,
        configured: Boolean = true,
    ) = IntegrationProvider(
        id = id,
        displayName = displayName,
        category = category,
        capabilities = capabilities,
        syncIntervalHours = syncIntervalHours,
        multiInstance = multiInstance,
        configured = configured,
    )

    private fun account(
        id: String,
        name: String? = null,
        mask: String? = null,
        balance: String?,
        currency: String = "EUR",
        includeInTotals: Boolean = true,
    ) = ConnectedAccount(
        id = id,
        name = name,
        mask = mask,
        balance = balance?.let { BigDecimal(it) },
        currency = currency,
        includeInTotals = includeInTotals,
    )
}
