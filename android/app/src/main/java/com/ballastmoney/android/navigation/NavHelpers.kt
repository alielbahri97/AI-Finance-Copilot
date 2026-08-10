package com.ballastmoney.android.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.toRoute

/**
 * The web path of whatever is on top of the back stack, or null for a
 * destination outside the navigation table.
 *
 * Derived from the back stack rather than remembered when a tab is tapped: the
 * two disagree the moment the user presses back, and a bottom bar that
 * highlights the wrong tab after back is the classic version of this bug.
 */
@Composable
fun NavHostController.currentWebPath(): String? {
    val entry by currentBackStackEntryAsState()
    val destination = entry?.destination ?: return null
    return when {
        destination.hasRoute<DashboardRoute>() -> DashboardRoute.webPath
        destination.hasRoute<TransactionsRoute>() -> TransactionsRoute.webPath
        destination.hasRoute<AccountsRoute>() -> AccountsRoute.webPath
        destination.hasRoute<ComingSoonRoute>() ->
            entry?.toRoute<ComingSoonRoute>()?.webPath
        else -> null
    }
}

/**
 * Switches top-level destination the way a bottom bar should.
 *
 * Popping back to the start destination while saving state means the stack never
 * grows one entry per tab tap, and returning to a tab restores where the user
 * was — a half-scrolled transactions list stays half-scrolled. `launchSingleTop`
 * stops a double tap from stacking two copies of the same screen.
 */
fun NavHostController.navigateToTab(route: Route) {
    navigate(route) {
        popUpTo(DashboardRoute) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
