package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.ChartCardSkeleton
import com.ballastmoney.android.designsystem.component.ErrorState
import com.ballastmoney.android.designsystem.component.ListRowSkeleton
import com.ballastmoney.android.designsystem.component.SkeletonText
import com.ballastmoney.android.designsystem.component.StatCardSkeleton
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.ui.BallastTestTags

/**
 * The dashboard.
 *
 * The public entry point is the only stateful composable in the package: it
 * subscribes to the ViewModel and owns the one piece of screen-local UI state
 * (whether the cash breakdown is open). [DashboardContent] takes everything as
 * arguments, which is what makes the whole screen previewable and testable
 * without Hilt, a network or a device.
 */
@Composable
fun DashboardScreen(
    onNavigateToTransactions: () -> Unit,
    onNavigateToAccounts: () -> Unit,
    onAddTransaction: () -> Unit,
    modifier: Modifier = Modifier,
    /**
     * Insets the shell has not already consumed. The default is the full
     * safe-drawing inset so the screen is correct on its own; a shell that puts
     * this inside a `Scaffold` should pass the scaffold's padding instead. From
     * API 36 there is no edge-to-edge opt-out, so something has to own this and
     * a parameter makes it obvious which.
     */
    contentPadding: PaddingValues = WindowInsets.safeDrawing.asPaddingValues(),
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showCashBreakdown by rememberSaveable { mutableStateOf(false) }

    DashboardContent(
        state = state,
        showCashBreakdown = showCashBreakdown,
        onToggleCashBreakdown = { showCashBreakdown = !showCashBreakdown },
        onRefresh = viewModel::refresh,
        onAddTransaction = onAddTransaction,
        // There is no import screen and no budgets screen in this client yet.
        // Both land on banks and accounts, which is the closest real
        // destination; the coordinating agent should re-point them when those
        // screens exist.
        onImport = onNavigateToAccounts,
        onConnectBank = onNavigateToAccounts,
        onSetBudget = onNavigateToAccounts,
        onViewAllTransactions = onNavigateToTransactions,
        modifier = modifier,
        contentPadding = contentPadding,
    )
}

@Composable
fun DashboardContent(
    state: DashboardUiState,
    showCashBreakdown: Boolean,
    onToggleCashBreakdown: () -> Unit,
    onRefresh: () -> Unit,
    onAddTransaction: () -> Unit,
    onImport: () -> Unit,
    onConnectBank: () -> Unit,
    onSetBudget: () -> Unit,
    onViewAllTransactions: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
) {
    val layoutDirection = LocalLayoutDirection.current
    // The caller's insets and the screen's own gutter are added together rather
    // than one winning: a display cutout and a 16dp margin are both real.
    val listPadding = PaddingValues(
        start = contentPadding.calculateStartPadding(layoutDirection) + BallastSpacing.lg,
        top = contentPadding.calculateTopPadding() + BallastSpacing.lg,
        end = contentPadding.calculateEndPadding(layoutDirection) + BallastSpacing.lg,
        bottom = contentPadding.calculateBottomPadding() + BallastSpacing.xxl,
    )

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .testTag(BallastTestTags.DASHBOARD_LIST),
        contentPadding = listPadding,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        when (state) {
            DashboardUiState.Loading -> loadingSkeletons()

            is DashboardUiState.Error -> {
                // Bound to a local rather than relying on the smart cast holding
                // inside the item lambda.
                val message = state.message
                item(key = "error") {
                    ErrorState(
                        title = DashboardCopy.ERROR_TITLE,
                        // The failure reason on its own is often a bare network
                        // string, so the actionable half is appended rather than
                        // left for the user to infer.
                        description = "$message ${DashboardCopy.ERROR_RETRY_HINT}",
                        onRetry = onRefresh,
                    )
                }
            }

            is DashboardUiState.Ready -> {
                val ready = state
                item(key = "header") {
                    DashboardHeader(
                        greeting = ready.greeting,
                        subtitle = ready.subtitle,
                        canEditTransactions = ready.can(Permission.EDIT_TRANSACTIONS),
                        isRefreshing = ready.isRefreshing,
                        onAddTransaction = onAddTransaction,
                        onImport = onImport,
                        onRefresh = onRefresh,
                    )
                }
                if (ready.snapshot.hasNoFinancialData) {
                    item(key = "getting-started") {
                        GettingStartedCard(
                            edition = ready.edition,
                            canEditTransactions = ready.can(Permission.EDIT_TRANSACTIONS),
                            onConnectBank = onConnectBank,
                            onUploadStatement = onImport,
                            onAddManually = onAddTransaction,
                            onLearnAboutImporting = onImport,
                        )
                    }
                } else {
                    when (ready.edition) {
                        WorkspaceType.BUSINESS -> businessDashboardSections(
                            state = ready,
                            showCashBreakdown = showCashBreakdown,
                            onToggleCashBreakdown = onToggleCashBreakdown,
                            onViewAllTransactions = onViewAllTransactions,
                        )

                        WorkspaceType.PERSONAL -> personalDashboardSections(
                            state = ready,
                            showCashBreakdown = showCashBreakdown,
                            onToggleCashBreakdown = onToggleCashBreakdown,
                            onViewAllTransactions = onViewAllTransactions,
                            onSetBudget = onSetBudget,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Placeholders shaped like the real thing.
 *
 * A spinner tells you to wait; a skeleton tells you what you are waiting for,
 * and the layout does not jump when the data lands because the boxes are
 * already the right size.
 */
private fun LazyListScope.loadingSkeletons() {
    item(key = "skeleton-header") {
        SkeletonText(lines = 2, lastLineFraction = 0.6f)
    }
    item(key = "skeleton-stats") {
        // Four identical placeholders: no hero row, because which card is the
        // hero is not known until the edition is.
        val placeholders = listOf<@Composable (Modifier) -> Unit>(
            { cardModifier -> StatCardSkeleton(modifier = cardModifier) },
            { cardModifier -> StatCardSkeleton(modifier = cardModifier) },
            { cardModifier -> StatCardSkeleton(modifier = cardModifier) },
            { cardModifier -> StatCardSkeleton(modifier = cardModifier) },
        )
        StatCardGrid(cards = placeholders, heroSpansNarrowWidth = false)
    }
    item(key = "skeleton-chart-1") { ChartCardSkeleton() }
    item(key = "skeleton-chart-2") { ChartCardSkeleton() }
    item(key = "skeleton-rows") { ListRowSkeleton(rows = 5) }
}
