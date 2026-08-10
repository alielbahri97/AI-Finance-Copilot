package com.ballastmoney.android.ui.dashboard

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.theme.BallastTheme

/**
 * Previews for the whole screen.
 *
 * They all render [DashboardContent], the stateless half, so none of them needs
 * Hilt or a fake repository — the state object *is* the fixture. The tall
 * `heightDp` values are there because a dashboard is a long page and a preview
 * clipped at 800dp hides the half worth checking.
 *
 * `darkTheme` is always passed explicitly rather than relying on a default in
 * the design-system theme, so these compile whatever that default turns out to
 * be.
 */
@Preview(name = "Business", showBackground = true, widthDp = 412, heightDp = 2200)
@Composable
private fun BusinessDashboardPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.businessReady)
    }
}

@Preview(name = "Business, cash breakdown open", showBackground = true, widthDp = 412, heightDp = 900)
@Composable
private fun BusinessDashboardBreakdownPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(
            state = DashboardPreviewData.businessReady,
            showCashBreakdown = true,
        )
    }
}

@Preview(name = "Business, dark", showBackground = true, widthDp = 412, heightDp = 2200)
@Composable
private fun BusinessDashboardDarkPreview() {
    BallastTheme(darkTheme = true) {
        PreviewDashboard(state = DashboardPreviewData.businessReady)
    }
}

@Preview(name = "Business, tablet width", showBackground = true, widthDp = 1024, heightDp = 1600)
@Composable
private fun BusinessDashboardWidePreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.businessReady)
    }
}

@Preview(name = "Personal", showBackground = true, widthDp = 412, heightDp = 2800)
@Composable
private fun PersonalDashboardPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.personalReady)
    }
}

@Preview(name = "Personal, no budgets", showBackground = true, widthDp = 412, heightDp = 900)
@Composable
private fun PersonalDashboardNoBudgetsPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(
            state = DashboardPreviewData.personalReady.copy(
                snapshot = DashboardPreviewData.personalSnapshotWithoutBudgets,
            ),
        )
    }
}

@Preview(name = "Personal, over budget", showBackground = true, widthDp = 412, heightDp = 900)
@Composable
private fun PersonalDashboardOverBudgetPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(
            state = DashboardPreviewData.personalReady.copy(
                snapshot = DashboardPreviewData.personalSnapshotOverBudget,
            ),
        )
    }
}

@Preview(name = "Getting started", showBackground = true, widthDp = 412, heightDp = 700)
@Composable
private fun GettingStartedPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.gettingStartedReady)
    }
}

@Preview(name = "Getting started, read-only", showBackground = true, widthDp = 412, heightDp = 500)
@Composable
private fun GettingStartedReadOnlyPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.gettingStartedReadOnlyReady)
    }
}

@Preview(name = "Getting started, tablet width", showBackground = true, widthDp = 1024, heightDp = 500)
@Composable
private fun GettingStartedWidePreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardPreviewData.gettingStartedReady)
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 412, heightDp = 900)
@Composable
private fun LoadingPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(state = DashboardUiState.Loading)
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 412, heightDp = 400)
@Composable
private fun ErrorPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(
            state = DashboardUiState.Error("We couldn't reach Ballast just now."),
        )
    }
}

@Preview(name = "Refreshing over cached data", showBackground = true, widthDp = 412, heightDp = 700)
@Composable
private fun RefreshingPreview() {
    BallastTheme(darkTheme = false) {
        PreviewDashboard(
            state = DashboardPreviewData.businessReady.copy(isRefreshing = true),
        )
    }
}

/** One place for the eight no-op callbacks every preview would otherwise repeat. */
@Composable
private fun PreviewDashboard(
    state: DashboardUiState,
    showCashBreakdown: Boolean = false,
) {
    DashboardContent(
        state = state,
        showCashBreakdown = showCashBreakdown,
        onToggleCashBreakdown = {},
        onRefresh = {},
        onAddTransaction = {},
        onImport = {},
        onConnectBank = {},
        onSetBudget = {},
        onViewAllTransactions = {},
    )
}
