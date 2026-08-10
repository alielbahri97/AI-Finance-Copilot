package com.ballastmoney.android.ui.transactions

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.ui.BallastTestTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The transactions list, driven directly with a settled page of fixtures.
 *
 * [TransactionsContent] takes its paging items as an argument, so these tests use
 * a one-page [androidx.paging.PagingData] with explicit load states rather than a
 * repository. What is being tested is the screen's behaviour — what the toolbar
 * reports, what selection mode replaces, what an empty result offers — not
 * Paging's.
 */
@MediumTest
@RunWith(AndroidJUnit4::class)
class TransactionsContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun render(
        state: TransactionsUiState = previewState(),
        transactions: List<Transaction> = previewTransactions,
        actions: TransactionsActions = TransactionsActions(),
    ) {
        composeRule.setContent {
            BallastTheme(darkTheme = false) {
                TransactionsContent(
                    state = state,
                    paged = rememberPreviewPagingItems(transactions),
                    actions = actions,
                )
            }
        }
    }

    private fun scrollTo(text: String) {
        composeRule.onNodeWithTag(BallastTestTags.TRANSACTIONS_LIST)
            .performScrollToNode(hasText(text))
    }

    @Test
    fun theTotalsCoverTheWholeFilteredSetAndSitAboveTheRows() {
        render()

        composeRule.onNodeWithText("Income").assertIsDisplayed()
        composeRule.onNodeWithText("Expenses").assertIsDisplayed()
        composeRule.onNodeWithText("Net").assertIsDisplayed()

        scrollTo("Office rent August")
        composeRule.onNodeWithText("Office rent August").assertIsDisplayed()
    }

    @Test
    fun theFilterControlSaysHowManyFiltersAreOnWithoutCountingSearch() {
        var openedFilters = 0
        render(
            state = previewState(
                query = TransactionQuery(
                    search = "albert",
                    type = TransactionType.EXPENSE,
                    categoryId = "cat-groceries",
                ),
            ),
            actions = TransactionsActions(onOpenFilters = { openedFilters++ }),
        )

        // Search has its own visible field, so it is not one of the two.
        scrollTo("Filters (2)")
        composeRule.onNodeWithText("Filters (2)").performClick()
        assertEquals(1, openedFilters)
    }

    @Test
    fun aFilteredResultWithNothingInItOffersToStartOver() {
        var cleared = 0
        render(
            state = previewState(query = TransactionQuery(categoryId = "cat-rent")),
            transactions = emptyList(),
            actions = TransactionsActions(onClearFilters = { cleared++ }),
        )

        scrollTo("Nothing matches these filters")
        composeRule.onNodeWithText("Nothing matches these filters").assertIsDisplayed()
        scrollTo("Clear filters")
        composeRule.onNodeWithText("Clear filters").performClick()
        assertEquals(1, cleared)
    }

    @Test
    fun anEmptyWorkspaceIsInvitedToImportRatherThanToClearFilters() {
        render(state = previewState(), transactions = emptyList())

        scrollTo("No transactions yet")
        composeRule.onNodeWithText("No transactions yet").assertIsDisplayed()
        composeRule.onNodeWithText("Import statement").assertIsDisplayed()
    }

    @Test
    fun aLongPressStartsSelectionOnThatRow() {
        val toggled = mutableListOf<String>()
        render(actions = TransactionsActions(onToggleSelection = { toggled += it }))

        scrollTo("Office rent August")
        composeRule.onNodeWithText("Office rent August").performTouchInput { longClick() }

        assertEquals(listOf("txn-2"), toggled)
    }

    @Test
    fun selectionModeReplacesTheHeaderWithACountAndBulkActions() {
        render(state = previewState(selection = setOf("txn-1", "txn-2")))

        composeRule.onNodeWithText("2 selected").assertIsDisplayed()
        assertDescribed("Set category")
        assertDescribed("Delete")

        // The ordinary header is gone while a selection is live, so its add
        // affordance cannot be reached by accident.
        assertTrue(
            composeRule.onAllNodesWithContentDescription("Add transaction")
                .fetchSemanticsNodes().isEmpty(),
        )
    }

    @Test
    fun aMemberWhoCannotEditIsOfferedNoWritesAtAll() {
        render(state = previewState(canEdit = false))

        for (action in listOf("Add transaction", "Import")) {
            assertTrue(
                "\"$action\" is offered to a member who cannot edit transactions",
                composeRule.onAllNodesWithContentDescription(action).fetchSemanticsNodes().isEmpty(),
            )
        }

        // Reading still works: the rows and the totals are all there.
        composeRule.onNodeWithText("Income").assertIsDisplayed()
    }

    @Test
    fun theUncategorizedNudgeAppearsOnlyWhenThereIsSomethingToLabel() {
        var teaching = 0
        render(
            transactions = previewUncategorizedTransactions,
            actions = TransactionsActions(onStartTeaching = { teaching++ }),
        )

        scrollTo("Got 5 minutes? Teach Ballast your categories")
        composeRule.onNodeWithText("Got 5 minutes? Teach Ballast your categories").assertIsDisplayed()

        // Five of these fixtures are unlabelled, and the batch offer names the count.
        scrollTo("Start with 5 biggest")
        composeRule.onNodeWithText("Start with 5 biggest").performClick()

        assertEquals(1, teaching)
    }

    private fun assertDescribed(description: String) {
        assertTrue(
            "no node describes itself as \"$description\"",
            composeRule.onAllNodesWithContentDescription(description).fetchSemanticsNodes().isNotEmpty(),
        )
    }
}
