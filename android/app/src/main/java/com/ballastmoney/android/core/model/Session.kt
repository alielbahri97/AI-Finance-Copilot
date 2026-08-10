package com.ballastmoney.android.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * Shape of `GET /api/session/bootstrap`.
 *
 * Everything the shell needs to decide what to render is here in one payload:
 * who the user is, which workspaces they can reach, which edition the current
 * workspace runs, what they are allowed to do, and what their plan includes.
 * The navigation graph is derived from this and nothing else.
 */
@Serializable
data class SessionBootstrap(
    val profile: Profile,
    val workspaces: List<WorkspaceSummary>,
    val currentWorkspace: Workspace,
    val permissions: Set<Permission>,
    val entitlements: Entitlements,
    val onboarding: OnboardingState,
    val unreadNotifications: Int = 0,
)

@Serializable
data class Profile(
    val id: String,
    val email: String,
    val firstName: String? = null,
    val lastName: String? = null,
    val avatarUrl: String? = null,
    val isAdmin: Boolean = false,
) {
    val displayName: String
        get() = listOfNotNull(firstName, lastName)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { email }

    val initials: String
        get() {
            val first = firstName?.firstOrNull()
            val last = lastName?.firstOrNull()
            return when {
                first != null && last != null -> "$first$last".uppercase()
                first != null -> first.uppercase().toString()
                else -> email.take(2).uppercase()
            }
        }
}

@Serializable
data class WorkspaceSummary(
    val id: String,
    val name: String,
    val type: WorkspaceType,
)

@Serializable
data class Workspace(
    val id: String,
    val name: String,
    val type: WorkspaceType,
    /** ISO 4217 code. Drives every amount rendered for this workspace. */
    val currency: String,
    val role: WorkspaceRole,
)

/**
 * The two editions. Mirrors the Prisma `WorkspaceType` enum, including the
 * SCREAMING_CASE spelling, so the JSON needs no translation layer.
 */
@Serializable
enum class WorkspaceType {
    BUSINESS,
    PERSONAL,
}

@Serializable
enum class WorkspaceRole {
    OWNER,
    ADMIN,
    MEMBER,
    VIEWER,
}

/**
 * Feature set per edition. The web app keeps this in
 * `src/lib/workspace/editions.ts`; the serial names are the lowerCamelCase
 * strings that file uses.
 */
@Serializable
enum class EditionFeature {
    @SerialName("invoices")
    INVOICES,

    @SerialName("counterparties")
    COUNTERPARTIES,

    @SerialName("team")
    TEAM,

    @SerialName("budgets")
    BUDGETS,

    @SerialName("goals")
    GOALS,

    @SerialName("netWorth")
    NET_WORTH,

    @SerialName("subscriptions")
    SUBSCRIPTIONS,

    @SerialName("accounting")
    ACCOUNTING,
}

/**
 * Role permissions. Serial names match `ALL_PERMISSIONS` in
 * `src/lib/workspace/permissions.ts` exactly.
 */
@Serializable
enum class Permission {
    @SerialName("view_transactions")
    VIEW_TRANSACTIONS,

    @SerialName("edit_transactions")
    EDIT_TRANSACTIONS,

    @SerialName("view_invoices")
    VIEW_INVOICES,

    @SerialName("edit_invoices")
    EDIT_INVOICES,

    @SerialName("view_reports")
    VIEW_REPORTS,

    @SerialName("export_data")
    EXPORT_DATA,

    @SerialName("use_copilot")
    USE_COPILOT,

    @SerialName("manage_forecast")
    MANAGE_FORECAST,

    @SerialName("manage_integrations")
    MANAGE_INTEGRATIONS,

    @SerialName("view_billing")
    VIEW_BILLING,

    @SerialName("manage_members")
    MANAGE_MEMBERS,

    @SerialName("manage_settings")
    MANAGE_SETTINGS,
}

@Serializable
enum class PlanId {
    FREE,
    PRO,
    BUSINESS,
    ENTERPRISE,
    PLUS,
    PREMIUM,
}

@Serializable
data class Entitlements(
    val planId: PlanId,
    val isTrial: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val trialEndsAt: Instant? = null,
    val limits: PlanLimits,
)

/**
 * Paid-plan gates. A `null` numeric limit means unlimited, which is the same
 * convention the web app uses; `0` means none allowed.
 */
@Serializable
data class PlanLimits(
    val csvImportsPerMonth: Int? = null,
    val rowsPerImport: Int? = null,
    val aiMessagesPerMonth: Int? = null,
    val aiCategorizationPerMonth: Int? = null,
    val invoiceExtractionsPerMonth: Int? = null,
    val dunningEnabled: Boolean = false,
    val exportsEnabled: Boolean = false,
    val assumptionsEnabled: Boolean = false,
    val maxScenarios: Int? = null,
    val integrationsEnabled: Boolean = false,
    val bankConnections: Int? = null,
    val goalsEnabled: Boolean = false,
    val netWorthEnabled: Boolean = false,
    val subscriptionInsightsEnabled: Boolean = false,
    val seats: Int? = null,
    val crossEditionEnabled: Boolean = false,
)

@Serializable
data class OnboardingState(
    val completed: Boolean,
    val hasBankConnection: Boolean = false,
    val hasTransactions: Boolean = false,
)
