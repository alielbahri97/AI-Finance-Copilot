package com.ballastmoney.android.ui.dashboard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.ui.BallastTestTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The dashboard, driven directly rather than through the shell.
 *
 * [DashboardContent] takes its whole world as arguments, so each test states an
 * edition and a permission set and asserts what the user is offered. That is the
 * part worth testing: which of the two editions' compositions renders, and
 * whether a read-only member is shown a write the server would refuse.
 */
@MediumTest
@RunWith(AndroidJUnit4::class)
class DashboardContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun render(
        state: DashboardUiState,
        showCashBreakdown: Boolean = false,
        onToggleCashBreakdown: () -> Unit = {},
        onAddTransaction: () -> Unit = {},
        onConnectBank: () -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        composeRule.setContent {
            BallastTheme(darkTheme = false) {
                DashboardContent(
                    state = state,
                    showCashBreakdown = showCashBreakdown,
                    onToggleCashBreakdown = onToggleCashBreakdown,
                    onRefresh = onRefresh,
                    onAddTransaction = onAddTransaction,
                    onImport = {},
                    onConnectBank = onConnectBank,
                    onSetBudget = {},
                    onViewAllTransactions = {},
                )
            }
        }
    }

    /** A lazy list only composes what is on screen, so reaching a card means scrolling to it. */
    private fun scrollTo(text: String) {
        composeRule.onNodeWithTag(BallastTestTags.DASHBOARD_LIST)
            .performScrollToNode(hasText(text))
    }

    private fun assertNotOffered(label: String) {
        assertTrue(
            "\"$label\" is offered to a member who cannot edit transactions",
            composeRule.onAllNodesWithText(label).fetchSemanticsNodes().isEmpty(),
        )
    }

    @Test
    fun businessEditionShowsTheCashPositionAndItsMonthlyFigures() {
        render(DashboardPreviewData.businessReady)

        composeRule.onNodeWithText(DashboardCopy.BUSINESS_SUBTITLE).assertIsDisplayed()
        composeRule.onNodeWithText(DashboardCopy.TOTAL_CASH).assertIsDisplayed()

        scrollTo(DashboardCopy.INCOME_THIS_MONTH)
        composeRule.onNodeWithText(DashboardCopy.INCOME_THIS_MONTH).assertIsDisplayed()
        composeRule.onNodeWithText(DashboardCopy.EXPENSES_THIS_MONTH).assertIsDisplayed()
    }

    @Test
    fun personalEditionRenamesTheMonthlyFiguresAndAddsItsOwnSections() {
        render(DashboardPreviewData.personalReady)

        composeRule.onNodeWithText(DashboardCopy.PERSONAL_SUBTITLE).assertIsDisplayed()

        // The Personal edition deliberately avoids the words income and expenses.
        scrollTo(DashboardCopy.MONEY_IN_THIS_MONTH)
        composeRule.onNodeWithText(DashboardCopy.MONEY_IN_THIS_MONTH).assertIsDisplayed()
        composeRule.onNodeWithText(DashboardCopy.MONEY_OUT_THIS_MONTH).assertIsDisplayed()

        for (section in listOf(DashboardCopy.BUDGETS, DashboardCopy.SAVINGS_GOALS, DashboardCopy.NET_WORTH)) {
            scrollTo(section)
            composeRule.onNodeWithText(section).assertIsDisplayed()
        }
    }

    @Test
    fun cashBreakdownIsAskedForRatherThanShownByDefault() {
        var toggles = 0
        render(
            state = DashboardPreviewData.businessReady,
            showCashBreakdown = false,
            onToggleCashBreakdown = { toggles++ },
        )

        scrollTo(DashboardCopy.SHOW_BREAKDOWN)
        composeRule.onNodeWithText(DashboardCopy.SHOW_BREAKDOWN).performClick()

        // The screen owns the flag, so the content composable only reports intent.
        assertEquals(1, toggles)
    }

    @Test
    fun anEmptyWorkspaceGetsTheGettingStartedCardInsteadOfEmptyCharts() {
        var connectBankTaps = 0
        render(
            state = DashboardPreviewData.gettingStartedReady,
            onConnectBank = { connectBankTaps++ },
        )

        composeRule.onNodeWithText(DashboardCopy.GETTING_STARTED_TITLE).assertIsDisplayed()
        // The charts belong to the populated body, which this state replaces whole.
        assertTrue(
            composeRule.onAllNodesWithText(DashboardCopy.TOTAL_CASH).fetchSemanticsNodes().isEmpty(),
        )

        scrollTo(DashboardCopy.TILE_BANK_TITLE)
        composeRule.onNodeWithText(DashboardCopy.TILE_BANK_TITLE).performClick()
        assertEquals(1, connectBankTaps)
    }

    @Test
    fun aReadOnlyMemberIsOfferedNoWayToAddData() {
        render(DashboardPreviewData.gettingStartedReadOnlyReady)

        scrollTo(DashboardCopy.GETTING_STARTED_NO_PERMISSION)
        composeRule.onNodeWithText(DashboardCopy.GETTING_STARTED_NO_PERMISSION).assertIsDisplayed()

        // Gated rather than disabled: the write is not offered at all.
        assertNotOffered(DashboardCopy.ADD_TRANSACTION)
        assertNotOffered(DashboardCopy.IMPORT)
        assertNotOffered(DashboardCopy.TILE_BANK_TITLE)
    }

    @Test
    fun aFailedLoadOffersARetryRatherThanAnEmptyDashboard() {
        var retries = 0
        render(
            state = DashboardUiState.Error(DashboardCopy.GENERIC_ERROR),
            onRefresh = { retries++ },
        )

        composeRule.onNodeWithText(DashboardCopy.ERROR_TITLE).assertIsDisplayed()
        composeRule.onAllNodesWithText("Try again").onFirst().performClick()

        assertEquals(1, retries)
    }
}
