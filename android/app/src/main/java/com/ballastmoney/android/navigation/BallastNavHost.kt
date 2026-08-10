package com.ballastmoney.android.navigation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.ballastmoney.android.data.auth.AuthCallbackLink
import com.ballastmoney.android.ui.accounts.AccountsScreen
import com.ballastmoney.android.ui.auth.ForgotPasswordScreen
import com.ballastmoney.android.ui.auth.LoginScreen
import com.ballastmoney.android.ui.auth.ResetPasswordScreen
import com.ballastmoney.android.ui.auth.SignupScreen
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
                    // Only reached for providers other than GoCardless. The
                    // GoCardless flow is a sheet over the accounts screen, since
                    // it has to pick a bank before it has a URL to open, so the
                    // screen intercepts that one and never calls this. The rest
                    // have no mobile flow yet and are sent to the web app.
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

/**
 * The signed-out graph: sign in, sign up, and the two halves of a password
 * reset.
 *
 * A separate [NavHost] rather than four more destinations above. The shell
 * chooses between the two graphs on the session, so signing out disposes of
 * this one's counterpart entirely — there is no way for a back gesture to reach
 * a dashboard belonging to the account that just left, because those entries no
 * longer exist.
 *
 * [recoveryLink] both selects the start destination and is handed to the screen
 * that needs it. When someone arrives from a reset email the first thing they
 * should see is the new-password form, not a sign-in form asking for the
 * password they have forgotten. It is deliberately a parameter rather than a
 * route argument: it carries a live token, and route arguments are persisted
 * into saved instance state.
 */
@Composable
fun AuthNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier,
    recoveryLink: AuthCallbackLink? = null,
) {
    NavHost(
        navController = navController,
        startDestination = if (recoveryLink != null) ResetPasswordRoute else LoginRoute,
        modifier = modifier.fillMaxSize(),
    ) {
        composable<LoginRoute> {
            LoginScreen(
                onNavigateToSignup = { navController.navigate(SignupRoute) },
                onNavigateToForgotPassword = { navController.navigate(ForgotPasswordRoute) },
            )
        }

        composable<SignupRoute> {
            SignupScreen(onNavigateToLogin = navController::navigateToLogin)
        }

        composable<ForgotPasswordRoute> {
            ForgotPasswordScreen(onNavigateToLogin = navController::navigateToLogin)
        }

        composable<ResetPasswordRoute> {
            ResetPasswordScreen(
                link = recoveryLink,
                onNavigateToLogin = navController::navigateToLogin,
            )
        }
    }
}
