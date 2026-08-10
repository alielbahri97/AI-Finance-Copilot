package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import com.ballastmoney.android.core.model.LockedReason
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.ui.BallastTestTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The banks and accounts screen.
 *
 * Rendered with the fixed clock the fixtures carry, because half of what this
 * screen says is about time — when a connection last synced, how long a consent
 * has left — and a test that reads `Instant.now()` would start failing on a date
 * nobody chose.
 */
@MediumTest
@RunWith(AndroidJUnit4::class)
class AccountsContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun render(
        state: AccountsUiState,
        actions: AccountsActions = AccountsActions(),
    ) {
        composeRule.setContent {
            BallastTheme(darkTheme = false) {
                AccountsContent(
                    state = state,
                    actions = actions,
                    contentPadding = PaddingValues(),
                    now = AccountsPreviewData.now,
                    today = AccountsPreviewData.today,
                )
            }
        }
    }

    private fun scrollTo(text: String) {
        composeRule.onNodeWithTag(BallastTestTags.ACCOUNTS_LIST).performScrollToNode(hasText(text))
    }

    @Test
    fun everyConnectionIsListedWithItsBankName() {
        render(AccountsPreviewData.ready())

        composeRule.onNodeWithText("Banks & accounts").assertIsDisplayed()

        scrollTo("Your connections")
        composeRule.onNodeWithText("Your connections").assertIsDisplayed()

        for (bank in listOf("ING", "Revolut Business")) {
            scrollTo(bank)
            composeRule.onNodeWithText(bank).assertIsDisplayed()
        }
    }

    @Test
    fun theCountedBalanceIsShownSeparatelyFromTheAccountsThatMakeItUp() {
        render(AccountsPreviewData.ready())

        // The dashboard's cash figure comes from here, so the screen states what
        // it counts rather than leaving the user to add the rows up.
        scrollTo("Counted balance")
        composeRule.onNodeWithText("Counted balance").assertIsDisplayed()
    }

    @Test
    fun eachIncludeInTotalsSwitchNamesTheAccountItGoverns() {
        val toggles = mutableListOf<Triple<String, String, Boolean>>()
        render(
            state = AccountsPreviewData.ready(connections = listOf(AccountsPreviewData.ing)),
            actions = AccountsActions(
                onToggleAccount = { connectionId, accountId, include ->
                    toggles += Triple(connectionId, accountId, include)
                },
            ),
        )

        val description = "Count \u2022\u20224321 in totals"
        composeRule.onNodeWithTag(BallastTestTags.ACCOUNTS_LIST)
            .performScrollToNode(hasContentDescription(description))
        composeRule.onNodeWithContentDescription(description).performClick()

        // That account is counted today, so the switch asks for it to stop being.
        assertEquals(listOf(Triple("conn-ing", "acc-ing-1", false)), toggles)
    }

    @Test
    fun anExpiredConsentAsksToBeReconnectedRatherThanSynced() {
        val reconnected = mutableListOf<String>()
        render(
            state = AccountsPreviewData.ready(connections = listOf(AccountsPreviewData.bunqExpired)),
            actions = AccountsActions(onConnectProvider = { reconnected += it }),
        )

        scrollTo("Reconnect")
        composeRule.onNodeWithText("Reconnect").performClick()

        // Reconnecting goes through the provider, not the dead connection.
        assertEquals(listOf("gocardless"), reconnected)
    }

    @Test
    fun aWorkspaceWithoutTheFeatureIsSentToBillingInsteadOfAWallOfProviders() {
        var billingVisits = 0
        render(
            state = AccountsPreviewData.ready(lockedReason = LockedReason.UPGRADE_REQUIRED),
            actions = AccountsActions(onNavigateToBilling = { billingVisits++ }),
        )

        scrollTo("Integrations are a Business feature")
        composeRule.onNodeWithText("Integrations are a Business feature").assertIsDisplayed()
        scrollTo("Upgrade plan")
        composeRule.onNodeWithText("Upgrade plan").performClick()

        assertEquals(1, billingVisits)
    }

    @Test
    fun withNoBankConnectedTheScreenLeadsWithConnectingOne() {
        val opened = mutableListOf<String>()
        render(
            state = AccountsPreviewData.ready(connections = emptyList()),
            actions = AccountsActions(onOpenProvider = { opened += it }),
        )

        scrollTo("No banks connected")
        composeRule.onNodeWithText("Connect a bank").performClick()

        // The first banking provider in registry order, not an arbitrary one.
        assertEquals(listOf("gocardless"), opened)
    }

    @Test
    fun aPermissionWallOffersNoRetryBecauseRetryingCannotHelp() {
        render(
            AccountsUiState.Error(
                message = "You need the Manage integrations permission to see connected banks.",
                retryable = false,
            ),
        )

        assertTrue(
            composeRule.onAllNodesWithText("Try again").fetchSemanticsNodes().isEmpty(),
        )
    }

    @Test
    fun aFailedLoadCanBeRetried() {
        var retries = 0
        render(
            state = AccountsUiState.Error("We couldn't reach Ballast."),
            actions = AccountsActions(onRefresh = { retries++ }),
        )

        composeRule.onNodeWithText("Try again").performClick()
        assertEquals(1, retries)
    }
}
