package com.ballastmoney.android.navigation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.ballastmoney.android.ui.accounts.AccountsScreen
import com.ballastmoney.android.ui.dashboard.DashboardScreen
import com.ballastmoney.android.ui.shell.ComingSoonScreen
import com.ballastmoney.android.ui.transactions.TransactionsScreen

/**
 * The graph. Three real screens and one placeholder that stands in for every
 * destination the web app has and this release does not.
 *
 * Routes are Kotlin objects rather than string templates, so a destination that
 * needs an argument cannot be navigated to without one — the compiler enforces
 * what used to be a runtime crash.
 *
 * [contentPadding] is the shell's insets, handed to each screen instead of being
 * applied here. Screens are scrolling lists, and a list has to inset its
 * *content* rather than itself, otherwise rows are clipped at the bottom bar
 * instead of passing under it.
 */
@Composable
fun BallastNavHost(
    navController: NavHostController,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = DashboardRoute,
        modifier = modifier.fillMaxSize(),
    ) {
        composable<DashboardRoute> {
            DashboardScreen(
                onNavigateToTransactions = { navController.navigateToTab(TransactionsRoute) },
                onNavigateToAccounts = { navController.navigateToTab(AccountsRoute) },
                // Adding a transaction is the transactions screen's own flow, so
                // the dashboard sends the user there rather than owning a second
                // copy of the editor sheet.
                onAddTransaction = { navController.navigateToTab(TransactionsRoute) },
                contentPadding = contentPadding,
            )
        }

        composable<TransactionsRoute> {
            TransactionsScreen(
                onNavigateToImport = {
                    navController.navigate(ComingSoonRoute(webPath = "/import", title = "Import"))
                },
                contentPadding = contentPadding,
            )
        }

        composable<AccountsRoute> {
            AccountsScreen(
                onNavigateToBilling = {
                    navController.navigate(ComingSoonRoute(webPath = "/billing", title = "Billing"))
                },
                onConnectProvider = { providerId ->
                    // Connecting a bank is an OAuth handoff to the web app, which
                    // needs the real API and a Custom Tab. Until then the screen
                    // says so rather than opening a browser at a dead URL.
                    navController.navigate(
                        ComingSoonRoute(
                            webPath = "/integrations/$providerId",
                            title = "Connect a bank",
                        ),
                    )
                },
                contentPadding = contentPadding,
            )
        }

        composable<ComingSoonRoute> { entry ->
            val route = entry.toRoute<ComingSoonRoute>()
            ComingSoonScreen(title = route.title, webPath = route.webPath)
        }
    }
}
