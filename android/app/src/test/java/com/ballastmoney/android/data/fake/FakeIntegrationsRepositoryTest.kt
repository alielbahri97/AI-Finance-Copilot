package com.ballastmoney.android.data.fake

import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.ProviderCategory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class FakeIntegrationsRepositoryTest {

    private val business = FakeBallastData.BUSINESS_WORKSPACE_ID
    private val personal = FakeBallastData.PERSONAL_WORKSPACE_ID

    @Test
    @DisplayName("nothing is emitted until a refresh, so the screen can tell empty from unloaded")
    fun startsEmpty() = runTest {
        val repository = FakeIntegrationsRepository()
        assertNull(repository.overview(business).first())

        assertTrue(repository.refresh(business).isSuccess)
        assertTrue(repository.overview(business).first()!!.providers.isNotEmpty())
    }

    @Test
    @DisplayName("accounting providers exist only in the Business edition")
    fun accountingIsBusinessOnly() = runTest {
        val repository = FakeIntegrationsRepository()
        repository.refresh(business)
        repository.refresh(personal)

        val businessProviders = repository.overview(business).first()!!.providers
        val personalProviders = repository.overview(personal).first()!!.providers

        assertTrue(businessProviders.any { it.category == ProviderCategory.ACCOUNTING })
        assertFalse(
            personalProviders.any { it.category == ProviderCategory.ACCOUNTING },
            "a Personal workspace was offered an accounting provider it cannot connect",
        )
    }

    @Test
    @DisplayName("an expired consent refuses to sync instead of pretending to succeed")
    fun expiredConnectionCannotSync() = runTest {
        val repository = FakeIntegrationsRepository()
        repository.refresh(business)

        val expired = repository.overview(business).first()!!
            .connections.first { it.status == ConnectionStatus.EXPIRED }

        val result = repository.sync(business, expired.id)
        assertTrue(result.isFailure)
    }

    @Test
    @DisplayName("a healthy connection syncs and its last-sync time moves")
    fun healthyConnectionSyncs() = runTest {
        val repository = FakeIntegrationsRepository()
        repository.refresh(business)

        val healthy = repository.overview(business).first()!!
            .connections.first { it.status == ConnectionStatus.CONNECTED }
        val before = healthy.lastSyncAt

        val outcome = repository.sync(business, healthy.id)
        assertTrue(outcome.isSuccess)
        assertEquals(healthy.title, outcome.getOrThrow().connectionTitle)

        val after = repository.overview(business).first()!!
            .connections.first { it.id == healthy.id }.lastSyncAt
        // Not "after is later than before": the fixtures are pinned to a fake
        // today, so a real clock could sit either side of them. What matters is
        // that the sync wrote a new timestamp.
        assertTrue(after != null && after != before)
    }

    @Test
    @DisplayName("the include-in-totals toggle sticks, because the dashboard total depends on it")
    fun includeInTotalsToggles() = runTest {
        val repository = FakeIntegrationsRepository()
        repository.refresh(business)

        val connection = repository.overview(business).first()!!
            .connections.first { it.accounts.isNotEmpty() }
        val account = connection.accounts.first()

        assertTrue(
            repository.setIncludeInTotals(
                workspaceId = business,
                connectionId = connection.id,
                accountId = account.id,
                includeInTotals = false,
            ).isSuccess,
        )

        val updated = repository.overview(business).first()!!
            .connections.first { it.id == connection.id }
            .accounts.first { it.id == account.id }
        assertFalse(updated.includeInTotals)
    }

    @Test
    @DisplayName("disconnecting removes the connection and leaves the others alone")
    fun disconnectRemovesOnlyThatConnection() = runTest {
        val repository = FakeIntegrationsRepository()
        repository.refresh(business)
        val connections = repository.overview(business).first()!!.connections
        val target = connections.first()

        assertTrue(repository.disconnect(business, target.id).isSuccess)

        val remaining = repository.overview(business).first()!!.connections
        assertEquals(connections.size - 1, remaining.size)
        assertFalse(remaining.any { it.id == target.id })
    }
}
