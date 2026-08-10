package com.ballastmoney.android.ui.accounts

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.ui.graphics.vector.ImageVector
import com.ballastmoney.android.core.model.EditionFeature
import com.ballastmoney.android.core.model.Editions
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.core.model.ProviderCapability
import com.ballastmoney.android.core.model.ProviderCategory
import com.ballastmoney.android.core.model.WorkspaceType

/**
 * The presentation half of the integration registry.
 *
 * The API hands back [IntegrationProvider]s with an id, a name and a category
 * and nothing else, but the web tiles also carry a one-line description and the
 * detail sheet carries setup steps. Both are static per provider, so they live
 * here rather than travelling over the wire, copied verbatim from
 * `src/lib/integrations/registry.ts` and
 * `src/components/integrations/provider-guide.ts`.
 *
 * Anything the server sends that this file has not heard of still renders: it
 * falls into the "Other" group with a generic icon and the generic connect
 * step, which is what the web grid does with its leftovers.
 */

/**
 * Display groups for the tile list. Finer-grained than [ProviderCategory] —
 * the registry has one "productivity" category, the grid splits it into email
 * and messaging — so the ids are listed explicitly, matching `GROUPS` in
 * `integrations-grid.tsx`.
 */
enum class ProviderGroup(
    val label: String,
    val providerIds: List<String>,
) {
    BANKS("Banks", listOf("gocardless", "plaid", "tink")),
    ACCOUNTING("Accounting", listOf("quickbooks", "xero", "exact")),
    EMAIL_CALENDAR("Email & Calendar", listOf("gmail", "outlook", "google-calendar")),
    MESSAGING("Messaging", listOf("slack", "teams")),
    OTHER("Other", emptyList()),
}

data class ProviderGroupSection(
    val group: ProviderGroup,
    val providers: List<IntegrationProvider>,
)

/**
 * Banks lead and stay open; everything else is collapsed until asked for. The
 * first mobile release is about bank balances, and a phone has no room to
 * scroll past eight tiles that are not why anyone opened this screen.
 */
val DefaultExpandedGroups: Set<String> = setOf(ProviderGroup.BANKS.name)

/**
 * Splits providers into display groups, keeping the curated order within a
 * group but floating the ones that already have a connection to the top, as
 * the web grid does.
 */
fun groupProviders(
    providers: List<IntegrationProvider>,
    connectedProviderIds: Set<String> = emptySet(),
): List<ProviderGroupSection> {
    val byId = providers.associateBy { it.id }
    val claimed = mutableSetOf<String>()
    val sections = ProviderGroup.entries
        .filter { it != ProviderGroup.OTHER }
        .mapNotNull { group ->
            val members = group.providerIds.mapNotNull { id ->
                byId[id]?.also { claimed += id }
            }
            if (members.isEmpty()) {
                null
            } else {
                ProviderGroupSection(group, sortConnectedFirst(members, connectedProviderIds))
            }
        }
    val leftovers = providers.filterNot { it.id in claimed }
    return if (leftovers.isEmpty()) {
        sections
    } else {
        sections + ProviderGroupSection(
            ProviderGroup.OTHER,
            sortConnectedFirst(leftovers, connectedProviderIds),
        )
    }
}

private fun sortConnectedFirst(
    providers: List<IntegrationProvider>,
    connectedProviderIds: Set<String>,
): List<IntegrationProvider> =
    providers.sortedByDescending { it.id in connectedProviderIds }

/**
 * Whether an edition has any use for a provider, ported from
 * `editionAllowsProvider` in the registry.
 *
 * The server filters this list already, so this is belt-and-braces — but it is
 * the same table, so a Personal workspace can never be offered a QuickBooks
 * tile whose connect route would refuse it. Note that mailbox scanning goes
 * with invoices, not with accounting: Gmail and Outlook only exist here to feed
 * the invoice module, so they disappear in Personal too.
 */
fun editionAllowsProvider(type: WorkspaceType, provider: IntegrationProvider): Boolean = when {
    provider.category == ProviderCategory.ACCOUNTING ->
        Editions.hasFeature(type, EditionFeature.ACCOUNTING)

    provider.capabilities.any {
        it == ProviderCapability.INVOICES || it == ProviderCapability.EMAIL
    } -> Editions.hasFeature(type, EditionFeature.INVOICES)

    else -> true
}

fun capabilityLabel(capability: ProviderCapability): String = when (capability) {
    ProviderCapability.TRANSACTIONS -> "Transactions"
    ProviderCapability.INVOICES -> "Invoices"
    ProviderCapability.EMAIL -> "Email invoices"
    ProviderCapability.NOTIFICATIONS -> "Notifications"
    ProviderCapability.CALENDAR -> "Calendar"
}

/**
 * The web ships a hand-drawn SVG per provider. Material icons stand in for now:
 * a wordmark set has to be licensed and packaged, and a category glyph is
 * honest in the meantime.
 */
fun providerIcon(provider: IntegrationProvider): ImageVector = when (provider.id) {
    "gocardless", "plaid", "tink" -> Icons.Outlined.AccountBalance
    "quickbooks", "xero", "exact" -> Icons.Outlined.ReceiptLong
    "gmail", "outlook" -> Icons.Outlined.MailOutline
    "google-calendar" -> Icons.Outlined.CalendarMonth
    "slack", "teams" -> Icons.Outlined.Chat
    else -> when (provider.category) {
        ProviderCategory.BANKING -> Icons.Outlined.AccountBalance
        ProviderCategory.ACCOUNTING -> Icons.Outlined.ReceiptLong
        ProviderCategory.PRODUCTIVITY -> Icons.Outlined.Extension
    }
}

/** The tile's second line. Verbatim from the registry's `description`. */
fun providerDescription(providerId: String): String? = PROVIDER_DESCRIPTIONS[providerId]

/** The numbered "How to connect" steps. Verbatim from `provider-guide.ts`. */
fun providerConnectSteps(providerId: String): List<String> =
    PROVIDER_CONNECT_STEPS[providerId] ?: GENERIC_CONNECT_STEPS

/**
 * The label on the connect button. The bank guides say "Click Connect bank",
 * so the button has to agree with the step it is sitting under.
 */
fun connectButtonLabel(provider: IntegrationProvider): String =
    if (provider.category == ProviderCategory.BANKING) "Connect bank" else "Connect"

private val GENERIC_CONNECT_STEPS =
    listOf("Click Connect and follow the provider's sign-in flow.")

private val PROVIDER_DESCRIPTIONS: Map<String, String> = mapOf(
    "gocardless" to "PSD2 account access (ex-Nordigen); syncs bank transactions.",
    "plaid" to "Connect US/EU bank accounts and sync transactions automatically.",
    "tink" to "European open-banking aggregation; syncs account transactions.",
    "quickbooks" to "Pulls bills and invoices from QuickBooks Online.",
    "xero" to "Pulls receivable and payable invoices from Xero.",
    "exact" to "Pulls sales invoices and purchase entries from Exact Online.",
    "gmail" to "Scans your inbox for PDF invoices and imports them for review.",
    "outlook" to "Scans your Microsoft 365 mailbox for PDF invoices.",
    "slack" to "Sends finance alerts and digests to a Slack channel.",
    "teams" to "Sends finance alerts and digests to a Teams channel via incoming webhook.",
    "google-calendar" to "Creates calendar events for upcoming bills and invoice due dates.",
)

private val PROVIDER_CONNECT_STEPS: Map<String, List<String>> = mapOf(
    "gocardless" to listOf(
        "Click Connect bank and pick your country and bank.",
        "You'll be sent to your bank to log in and approve read-only access.",
        "You'll be brought back here and the first import runs automatically.",
    ),
    "plaid" to listOf(
        "Click Connect — a secure Plaid window opens.",
        "Search for your bank and sign in there.",
        "Approve read-only access; your transactions start importing right away.",
    ),
    "tink" to listOf(
        "Click Connect — you'll be taken to Tink.",
        "Pick your bank and sign in there.",
        "Approve read-only access and you'll be brought back here.",
    ),
    "quickbooks" to listOf(
        "Click Connect and sign in to Intuit.",
        "Choose the company to share and approve read access.",
        "Bills and invoices start syncing automatically.",
    ),
    "xero" to listOf(
        "Click Connect and sign in to Xero.",
        "Choose the organisation to share and approve read access.",
        "Invoices start syncing automatically.",
    ),
    "exact" to listOf(
        "Click Connect and sign in to Exact Online.",
        "Approve access for your division.",
        "Invoices start syncing automatically.",
    ),
    "gmail" to listOf(
        "Click Connect and sign in with Google.",
        "Allow read-only access to your mailbox.",
        "Invoices found in your email appear under Invoices for review.",
    ),
    "outlook" to listOf(
        "Click Connect and sign in with Microsoft.",
        "Allow read-only access to your mailbox.",
        "Invoices found in your email appear under Invoices for review.",
    ),
    "slack" to listOf(
        "Click Connect and sign in to your Slack workspace.",
        "Pick the channel that should receive alerts.",
        "That's it — alerts and digests are posted there from now on.",
    ),
    "teams" to listOf(
        "In Teams, open the target channel's options and create an incoming webhook.",
        "Copy the webhook URL Teams gives you.",
        "Click Connect here, paste the URL and save — a test message confirms it works.",
    ),
    "google-calendar" to listOf(
        "Click Connect and sign in with Google.",
        "Allow access to create calendar events.",
        "Toggle event creation on, and upcoming bills appear in your calendar.",
    ),
)
