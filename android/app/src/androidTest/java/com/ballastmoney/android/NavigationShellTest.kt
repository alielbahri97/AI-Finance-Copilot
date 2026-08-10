package com.ballastmoney.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End-to-end checks on the shell, against the same fixtures the app ships with in
 * this build.
 *
 * Instrumented rather than Robolectric: the app is a single activity with real
 * window insets and a real bottom-sheet host, and the things most likely to break
 * — a sheet that will not open, a tab that does not change screens — only break in
 * a real window.
 */
@HiltAndroidTest
@MediumTest
@RunWith(AndroidJUnit4::class)
class NavigationShellTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    /** The fake session bootstrap takes a beat, so every test starts by waiting. */
    private fun awaitText(text: String) {
        composeRule.waitUntil(timeoutMillis = TIMEOUT_MS) {
            composeRule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun bottomBarShowsTheBusinessEditionTabs() {
        awaitText("Dashboard")

        composeRule.onNodeWithText("Dashboard").assertIsDisplayed()
        composeRule.onNodeWithText("Transactions").assertIsDisplayed()
        composeRule.onNodeWithText("Banks & accounts").assertIsDisplayed()
        composeRule.onNodeWithText("More").assertIsDisplayed()
    }

    @Test
    fun tappingTransactionsOpensTheTransactionsScreen() {
        awaitText("Transactions")

        composeRule.onNodeWithText("Transactions").performClick()
        awaitText("Income")

        // The income/expenses/net strip belongs to the transactions screen and
        // covers the whole filtered set, so its presence means the screen loaded.
        composeRule.onAllNodesWithText("Income").onFirst().assertIsDisplayed()
        composeRule.onAllNodesWithText("Expenses").onFirst().assertIsDisplayed()
    }

    @Test
    fun moreSheetListsDestinationsThisReleaseDoesNotHave() {
        awaitText("More")

        composeRule.onNodeWithText("More").performClick()
        awaitText("All of Ballast")

        composeRule.onNodeWithText("Reports").assertIsDisplayed()
        // Invoices is Business-only and the fake session starts in the Business
        // workspace, so it belongs here. The unit-level matrix test covers the
        // Personal case, where it must be absent.
        composeRule.onNodeWithText("Invoices").assertIsDisplayed()
        composeRule.onAllNodesWithText("Soon").onFirst().assertIsDisplayed()
    }

    @Test
    fun workspaceSwitcherMovesToThePersonalEdition() {
        awaitText("Northwind Studio")

        composeRule.onNodeWithContentDescription("Switch workspace").performClick()
        awaitText("Switch workspace")

        // "Personal" is both the workspace name and its edition label, so the
        // first match is the row title.
        composeRule.onAllNodesWithText("Personal").onFirst().performClick()

        // Budgets is Personal-only, so it appearing in the drawer proves the
        // switch reached the navigation table and not just the title.
        awaitText("More")
        composeRule.onNodeWithText("More").performClick()
        awaitText("Budgets")
        composeRule.onNodeWithText("Budgets").assertIsDisplayed()
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
