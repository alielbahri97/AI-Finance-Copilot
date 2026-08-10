package com.ballastmoney.android.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.Balance
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Savings
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.ui.graphics.vector.ImageVector
import com.ballastmoney.android.core.model.EditionFeature
import com.ballastmoney.android.core.model.Editions
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.WorkspaceType

/** Drawer grouping, matching `NavSectionId` on the web. */
enum class NavSection(val label: String) {
    MONEY("Money"),
    ANALYZE("Analyze"),
    ACCOUNT("Account"),
}

/**
 * One navigable destination.
 *
 * [webPath] is the identity, exactly as on the web where the href is the id.
 * Keeping it means the two navigation tables can be diffed by eye, and it gives
 * the deferred destinations something honest to point at.
 */
data class NavItem(
    val webPath: String,
    val title: String,
    val icon: ImageVector,
    val section: NavSection,
    /** Non-null when the destination only exists in one edition. */
    val feature: EditionFeature? = null,
    /** Non-null when the server would reject the request without it. */
    val permission: Permission? = null,
    val adminOnly: Boolean = false,
    /** Null while the screen is not built yet; routes to a placeholder. */
    val route: Route? = null,
) {
    val isBuilt: Boolean get() = route != null

    fun routeOrPlaceholder(): Route = route ?: ComingSoonRoute(webPath, title)
}

/**
 * The navigation table, ported from `src/components/dashboard/nav-items.ts`.
 *
 * Two things differ from the web deliberately.
 *
 * First, each item carries the permission its page checks. The web app filters
 * navigation by edition only and lets the page redirect a user who lacks the
 * permission — acceptable on a browser where a redirect is cheap and invisible.
 * On a phone a bottom-navigation tab that bounces you back is a bug, so the
 * permission is part of the table and [navItemsFor] applies it. The web test
 * suite asserts navigation never offers an edition-blocked path; the Android
 * test asserts the stronger property, for permissions too.
 *
 * Second, [NavItem.route] is null for everything this release has not built.
 * The entry stays in the table so the matrix is complete and testable, and it
 * resolves to a placeholder that names the feature instead of vanishing.
 */
object NavItems {

    val all: List<NavItem> = listOf(
        NavItem(
            webPath = "/dashboard",
            title = "Dashboard",
            icon = Icons.Outlined.GridView,
            section = NavSection.MONEY,
            route = DashboardRoute,
        ),
        NavItem(
            webPath = "/transactions",
            title = "Transactions",
            icon = Icons.Outlined.SwapHoriz,
            section = NavSection.MONEY,
            permission = Permission.VIEW_TRANSACTIONS,
            route = TransactionsRoute,
        ),
        NavItem(
            webPath = "/import",
            title = "Import",
            icon = Icons.Outlined.UploadFile,
            section = NavSection.MONEY,
            permission = Permission.EDIT_TRANSACTIONS,
        ),
        NavItem(
            webPath = "/categories",
            title = "Categories",
            icon = Icons.Outlined.LocalOffer,
            section = NavSection.MONEY,
            permission = Permission.VIEW_TRANSACTIONS,
        ),
        NavItem(
            webPath = "/invoices",
            title = "Invoices",
            icon = Icons.Outlined.Description,
            section = NavSection.MONEY,
            feature = EditionFeature.INVOICES,
            permission = Permission.VIEW_INVOICES,
        ),
        NavItem(
            webPath = "/budgets",
            title = "Budgets",
            icon = Icons.Outlined.AccountBalanceWallet,
            section = NavSection.MONEY,
            feature = EditionFeature.BUDGETS,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/goals",
            title = "Goals",
            icon = Icons.Outlined.Savings,
            section = NavSection.MONEY,
            feature = EditionFeature.GOALS,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/net-worth",
            title = "Net worth",
            icon = Icons.Outlined.Balance,
            section = NavSection.MONEY,
            feature = EditionFeature.NET_WORTH,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/subscriptions",
            title = "Subscriptions",
            icon = Icons.Outlined.Repeat,
            section = NavSection.MONEY,
            feature = EditionFeature.SUBSCRIPTIONS,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/forecast",
            title = "Forecast",
            icon = Icons.AutoMirrored.Outlined.ShowChart,
            section = NavSection.ANALYZE,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/reports",
            title = "Reports",
            icon = Icons.Outlined.Analytics,
            section = NavSection.ANALYZE,
            permission = Permission.VIEW_REPORTS,
        ),
        NavItem(
            webPath = "/copilot",
            title = "Copilot",
            icon = Icons.Outlined.SmartToy,
            section = NavSection.ANALYZE,
            permission = Permission.USE_COPILOT,
        ),
        NavItem(
            webPath = "/integrations",
            title = "Banks & accounts",
            icon = Icons.Outlined.AccountBalance,
            section = NavSection.ACCOUNT,
            permission = Permission.MANAGE_INTEGRATIONS,
            route = AccountsRoute,
        ),
        NavItem(
            webPath = "/billing",
            title = "Billing",
            icon = Icons.Outlined.CreditCard,
            section = NavSection.ACCOUNT,
            permission = Permission.VIEW_BILLING,
        ),
        NavItem(
            webPath = "/profile",
            title = "Profile",
            icon = Icons.Outlined.AccountCircle,
            section = NavSection.ACCOUNT,
        ),
        NavItem(
            webPath = "/settings",
            title = "Settings",
            icon = Icons.Outlined.Settings,
            section = NavSection.ACCOUNT,
        ),
        NavItem(
            webPath = "/help",
            title = "Help",
            icon = Icons.AutoMirrored.Outlined.HelpOutline,
            section = NavSection.ACCOUNT,
        ),
    )

    /** Appended only for profiles with `isAdmin`, as on the web. */
    val adminItem = NavItem(
        webPath = "/admin",
        title = "Admin",
        icon = Icons.Outlined.Shield,
        section = NavSection.ACCOUNT,
        adminOnly = true,
    )

    /**
     * Bottom-navigation destinations per edition.
     *
     * The web app uses `/copilot` as the third Business tab and `/budgets` as
     * the third Personal tab. Neither screen exists in this release, so both
     * editions get banks and accounts as their third tab instead. That is the
     * substitution the brief asks for on the Business side, applied to Personal
     * for the same reason.
     */
    private val tabBarPaths: Map<WorkspaceType, List<String>> = mapOf(
        WorkspaceType.BUSINESS to listOf("/dashboard", "/transactions", "/integrations"),
        WorkspaceType.PERSONAL to listOf("/dashboard", "/transactions", "/integrations"),
    )

    /** What the web app ships today, kept so a test can prove we track it. */
    val webTabBarPaths: Map<WorkspaceType, List<String>> = mapOf(
        WorkspaceType.BUSINESS to listOf("/dashboard", "/transactions", "/copilot"),
        WorkspaceType.PERSONAL to listOf("/dashboard", "/transactions", "/budgets"),
    )

    /**
     * Every destination this user may open, in display order.
     *
     * Filtered by edition, then by permission, then by admin flag. A caller
     * cannot get a forbidden item out of this function, which is the invariant
     * the navigation test pins down.
     */
    fun navItemsFor(
        type: WorkspaceType,
        permissions: Set<Permission>,
        isAdmin: Boolean = false,
    ): List<NavItem> {
        val visible = all.filter { item ->
            val editionAllows = item.feature == null || Editions.hasFeature(type, item.feature)
            val permissionAllows = item.permission == null || item.permission in permissions
            editionAllows && permissionAllows
        }
        return if (isAdmin) visible + adminItem else visible
    }

    fun navSectionsFor(
        type: WorkspaceType,
        permissions: Set<Permission>,
        isAdmin: Boolean = false,
    ): List<Pair<NavSection, List<NavItem>>> {
        val items = navItemsFor(type, permissions, isAdmin)
        return NavSection.entries
            .map { section -> section to items.filter { it.section == section } }
            .filter { (_, sectionItems) -> sectionItems.isNotEmpty() }
    }

    /**
     * The bottom bar. Only ever contains destinations that survived the same
     * filtering as the drawer, so a VIEWER — who has no `manage_integrations`
     * permission — sees two tabs rather than a third that would be refused.
     */
    fun tabBarItemsFor(
        type: WorkspaceType,
        permissions: Set<Permission>,
    ): List<NavItem> {
        val allowed = navItemsFor(type, permissions).associateBy { it.webPath }
        return tabBarPaths.getValue(type).mapNotNull { allowed[it] }
    }

    /**
     * Drawer contents: everything not already reachable from the bottom bar.
     */
    fun moreItemsFor(
        type: WorkspaceType,
        permissions: Set<Permission>,
        isAdmin: Boolean = false,
    ): List<Pair<NavSection, List<NavItem>>> {
        val tabPaths = tabBarItemsFor(type, permissions).map { it.webPath }.toSet()
        return navSectionsFor(type, permissions, isAdmin)
            .map { (section, items) -> section to items.filterNot { it.webPath in tabPaths } }
            .filter { (_, items) -> items.isNotEmpty() }
    }
}
