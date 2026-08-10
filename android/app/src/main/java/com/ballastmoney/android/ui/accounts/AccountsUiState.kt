package com.ballastmoney.android.ui.accounts

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.LockedReason
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.PlanLimits
import com.ballastmoney.android.core.model.WorkspaceType

/**
 * Everything the accounts screen renders from, and nothing it does not.
 *
 * [Ready] is deliberately built out of the domain models rather than a
 * flattened view model: the derivations in `AccountsPresentation.kt` are pure
 * functions of these, so there is exactly one copy of the truth and the screen
 * cannot drift from the payload.
 */
sealed interface AccountsUiState {

    data object Loading : AccountsUiState

    /**
     * [retryable] is false for the permission wall, where a retry button would
     * be a lie — nothing about pressing it can grant `manage_integrations`.
     */
    data class Error(val message: String, val retryable: Boolean = true) : AccountsUiState

    @Immutable
    data class Ready(
        val edition: WorkspaceType,
        val overview: IntegrationsOverview,
        /** The workspace's ISO 4217 code; accounts may differ from it. */
        val currency: String,
        val formatter: MoneyFormatter,
        val permissions: Set<Permission>,
        val limits: PlanLimits,
        val syncingConnectionIds: Set<String> = emptySet(),
        val disconnectingConnectionIds: Set<String> = emptySet(),
        val pendingAccountToggles: Set<String> = emptySet(),
        val isRefreshing: Boolean = false,
        /** Non-null while a provider's detail sheet is open. */
        val selectedProviderId: String? = null,
    ) : AccountsUiState {

        val locked: Boolean get() = overview.lockedReason == LockedReason.UPGRADE_REQUIRED

        val limitReached: Boolean get() = overview.lockedReason == LockedReason.LIMIT_REACHED

        val canManage: Boolean get() = Permission.MANAGE_INTEGRATIONS in permissions

        /** Providers this edition has any use for, in registry order. */
        val visibleProviders get() = overview.providers.filter { editionAllowsProvider(edition, it) }

        fun connectionsFor(providerId: String) =
            overview.connections.filter { it.providerId == providerId }
    }
}

/**
 * A one-shot notification. Transient by nature — it is consumed once and never
 * re-shown on rotation, which is exactly why it travels on a channel instead of
 * sitting in [AccountsUiState].
 */
@Immutable
data class AccountsMessage(
    val text: String,
    /** Sync stats, already rendered as `key: value` pairs. */
    val detail: String? = null,
    val isError: Boolean = false,
) {
    val display: String
        get() = if (detail.isNullOrBlank()) text else "$text ($detail)"
}

/**
 * Everything the screen can ask for, bundled so the stateless composables take
 * one parameter instead of eight and previews can pass no-ops.
 */
@Immutable
data class AccountsActions(
    val onRefresh: () -> Unit = {},
    val onNavigateToBilling: () -> Unit = {},
    val onConnectProvider: (providerId: String) -> Unit = {},
    val onSync: (connectionId: String) -> Unit = {},
    val onDisconnect: (connectionId: String) -> Unit = {},
    val onToggleAccount: (
        connectionId: String,
        accountId: String,
        includeInTotals: Boolean,
    ) -> Unit = { _, _, _ -> },
    val onOpenProvider: (providerId: String) -> Unit = {},
    val onDismissProvider: () -> Unit = {},
)

/**
 * One [MoneyFormatter] per currency, kept for the life of the composition.
 *
 * A foreign-currency account has to be formatted with its own currency or it
 * is mislabelled — a €2.000 balance rendered as £2,000 is not a cosmetic bug —
 * and building a [java.text.NumberFormat] per row would be wasteful, so the
 * instances are cached here and reused.
 *
 * Not thread-safe: it is created and read from composition only. The cache is
 * [Stable] because what it answers for a given currency never changes — the map
 * only saves the work of asking twice.
 */
@Stable
class MoneyFormatterCache(
    private val workspaceFormatter: MoneyFormatter,
    workspaceCurrency: String,
) {
    private val fallbackCurrency = workspaceCurrency.uppercase()
    private val cache = HashMap<String, MoneyFormatter>()

    fun forCurrency(currency: String?): MoneyFormatter {
        val code = currency?.trim()?.uppercase()?.takeIf { it.isNotEmpty() }
            ?: return workspaceFormatter
        if (code == fallbackCurrency) return workspaceFormatter
        return cache.getOrPut(code) { MoneyFormatter(code) }
    }
}
