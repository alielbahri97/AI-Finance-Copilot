package com.ballastmoney.android.ui.shell

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.core.view.WindowCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import com.ballastmoney.android.core.domain.ThemePreference
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.navigation.BallastNavHost
import com.ballastmoney.android.navigation.DashboardRoute
import com.ballastmoney.android.navigation.NavItems
import com.ballastmoney.android.navigation.currentWebPath
import com.ballastmoney.android.navigation.navigateToTab
import com.ballastmoney.android.ui.lock.SessionLockScreen
import kotlinx.coroutines.launch

/**
 * The whole app below the activity: theme, then one of four mutually exclusive
 * states.
 *
 * The lock is checked before anything else and replaces the tree rather than
 * covering it, so no screen behind it is composed, keeps collecting, or can flash
 * into view during a transition.
 */
@Composable
fun BallastApp(
    modifier: Modifier = Modifier,
    viewModel: RootViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    val darkTheme = when (state.theme) {
        ThemePreference.SYSTEM -> isSystemInDarkTheme()
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
    }

    BallastTheme(darkTheme = darkTheme) {
        SystemBarAppearance(darkTheme = darkTheme)

        val session = state.session
        when {
            state.isLocked -> SessionLockScreen(
                biometricUnlockEnabled = state.biometricUnlockEnabled,
                onUnlocked = viewModel::unlock,
                onSignOut = viewModel::signOut,
                modifier = modifier,
            )

            state.isLoading -> LoadingScreen(modifier = modifier)

            session == null -> BootstrapErrorScreen(
                message = state.errorMessage,
                onRetry = viewModel::retry,
                modifier = modifier,
            )

            else -> SignedInApp(
                session = session,
                usingSampleData = state.usingSampleData,
                onSelectWorkspace = viewModel::selectWorkspace,
                modifier = modifier,
            )
        }
    }
}

/**
 * Signed-in chrome: top bar, bottom bar, sheets and the navigation graph.
 *
 * The navigation table is asked for this session's items on every recomposition
 * of the workspace rather than cached, because a workspace switch changes both
 * the edition and the permission set, and stale tabs would point at destinations
 * the server now refuses.
 */
@Composable
private fun SignedInApp(
    session: SessionBootstrap,
    usingSampleData: Boolean,
    onSelectWorkspace: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val navController = rememberNavController()
    val edition = session.currentWorkspace.type
    val permissions = session.permissions

    val tabs = remember(edition, permissions) { NavItems.tabBarItemsFor(edition, permissions) }
    val moreSections = remember(edition, permissions, session.profile.isAdmin) {
        NavItems.moreItemsFor(edition, permissions, session.profile.isAdmin)
    }

    var showMoreSheet by remember { mutableStateOf(false) }
    var showWorkspaceSheet by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val currentWebPath = navController.currentWebPath()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            ShellTopBar(
                workspaceName = session.currentWorkspace.name,
                edition = edition,
                unreadNotifications = session.unreadNotifications,
                canSwitchWorkspace = session.workspaces.size > 1,
                onSwitchWorkspace = { showWorkspaceSheet = true },
                onOpenNotifications = {
                    // Notifications are not a screen in this release. Saying so
                    // beats a tab that opens an empty page.
                    scope.launch {
                        snackbarHostState.showSnackbar(
                            if (session.unreadNotifications > 0) {
                                "${session.unreadNotifications} unread notifications. " +
                                    "Notifications are on the web for now."
                            } else {
                                "No unread notifications."
                            },
                        )
                    }
                },
            )
        },
        bottomBar = {
            BallastBottomBar(
                items = tabs,
                selectedWebPath = currentWebPath,
                onSelect = { item -> navController.navigateToTab(item.routeOrPlaceholder()) },
                onOpenMore = { showMoreSheet = true },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        // The top inset is applied here so the notice sits below the app bar, but
        // the bottom inset is handed to the screens: their lists have to scroll
        // *under* the bottom bar, which means insetting content, not the list.
        Column(modifier = Modifier.padding(top = padding.calculateTopPadding())) {
            if (usingSampleData) {
                SampleDataNotice()
            }
            BallastNavHost(
                navController = navController,
                contentPadding = PaddingValues(bottom = padding.calculateBottomPadding()),
                modifier = Modifier.fillMaxSize(),
            )
        }
    }

    if (showMoreSheet) {
        BallastBottomSheet(
            onDismissRequest = { showMoreSheet = false },
            title = "All of Ballast",
        ) {
            MoreSheetContent(
                sections = moreSections,
                onSelect = { item ->
                    showMoreSheet = false
                    navController.navigateToTab(item.routeOrPlaceholder())
                },
            )
        }
    }

    if (showWorkspaceSheet) {
        BallastBottomSheet(
            onDismissRequest = { showWorkspaceSheet = false },
            title = "Switch workspace",
            description = "Business and personal money stay separate. Switching changes " +
                "every screen, not just this one.",
        ) {
            WorkspaceSwitcherContent(
                workspaces = session.workspaces,
                currentWorkspaceId = session.currentWorkspace.id,
                onSelect = { workspace ->
                    showWorkspaceSheet = false
                    if (workspace.id != session.currentWorkspace.id) {
                        // Back to the dashboard: a transactions filter or an
                        // account detail from the previous workspace means
                        // nothing in the new one.
                        navController.navigateToTab(DashboardRoute)
                        onSelectWorkspace(workspace.id)
                    }
                },
            )
        }
    }
}

/**
 * A one-line, permanent reminder that the numbers on screen are fixtures.
 *
 * It is not a dismissible banner on purpose. Every balance, chart and total in
 * this build is invented, and a reviewer or stakeholder looking at a screenshot
 * should be able to tell that from the screenshot.
 */
@Composable
private fun SampleDataNotice(modifier: Modifier = Modifier) {
    Text(
        text = "Sample data — not connected to your Ballast account",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.ballastColors.warningTinted,
        textAlign = TextAlign.Center,
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = BallastSpacing.xs),
    )
}

@Composable
private fun LoadingScreen(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun BootstrapErrorScreen(
    message: String?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(BallastSpacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Text(
                text = "We could not load Ballast",
                style = BallastTextStyles.pageTitle,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Text(
                text = message ?: "Check your connection and try again.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
                textAlign = TextAlign.Center,
            )
            BallastButton(text = "Try again", onClick = onRetry)
        }
    }
}

/**
 * Status and navigation bar icon colours.
 *
 * `enableEdgeToEdge` in the activity sets these once at startup, which is wrong
 * as soon as the user changes the in-app theme without changing the system one.
 */
@Composable
private fun SystemBarAppearance(darkTheme: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    SideEffect {
        val window = (view.context as Activity).window
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !darkTheme
            isAppearanceLightNavigationBars = !darkTheme
        }
    }
}
