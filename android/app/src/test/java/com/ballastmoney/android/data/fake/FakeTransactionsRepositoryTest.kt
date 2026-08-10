package com.ballastmoney.android.data.fake

import androidx.paging.testing.asSnapshot
import app.cash.turbine.test
import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.math.BigDecimal

/**
 * These tests are about the fake, but not only about the fake.
 *
 * The fake implements the filtering, sorting and paging contract that
 * `GET /api/transactions` will implement, and the transactions screen is built
 * against that contract. So the assertions here are the specification the real
 * endpoint has to satisfy — if the server sorts ties differently, or treats an
 * inverted date range as "no filter", the screen breaks and these tests are where
 * the disagreement should surface.
 */
class FakeTransactionsRepositoryTest {

    private val workspace = FakeBallastData.BUSINESS_WORKSPACE_ID

    private fun repository() = FakeTransactionsRepository()

    @Test
    @DisplayName("the default query pages newest first")
    fun defaultOrderIsNewestFirst() = runTest {
        val items = repository()
            .pagedTransactions(workspace, TransactionQuery())
            .asSnapshot()

        assertTrue(items.isNotEmpty())
        assertEquals(
            items.map { it.date }.sortedDescending(),
            items.map { it.date },
            "the first page is not in descending date order",
        )
    }

    @Test
    @DisplayName("paging walks the whole filtered set without repeating a row")
    fun pagingIsStable() = runTest {
        val query = TransactionQuery(pageSize = 20)
        val items = repository()
            .pagedTransactions(workspace, query)
            .asSnapshot {
                // Four appends past the initial load, which is more than enough to
                // catch an off-by-one in the offset keys.
                repeat(4) { scrollTo(index = 20 * (it + 1)) }
            }

        val ids = items.map { it.id }
        assertEquals(ids.size, ids.toSet().size, "paging returned the same transaction twice")
    }

    @Test
    @DisplayName("search matches description and counterparty, case-insensitively")
    fun searchFiltersBothFields() = runTest {
        val items = repository()
            .pagedTransactions(workspace, TransactionQuery(search = "colruyt"))
            .asSnapshot()

        assertTrue(items.isNotEmpty())
        assertTrue(
            items.all {
                it.description.contains("colruyt", ignoreCase = true) ||
                    it.counterparty?.contains("colruyt", ignoreCase = true) == true
            },
        )
    }

    @Test
    @DisplayName("the uncategorized sentinel selects rows with no category at all")
    fun uncategorizedSentinel() = runTest {
        val items = repository()
            .pagedTransactions(
                workspace,
                TransactionQuery(categoryId = TransactionQuery.UNCATEGORIZED),
            )
            .asSnapshot()

        assertTrue(items.isNotEmpty(), "the fixtures should contain uncategorised rows")
        assertTrue(items.all { it.categoryId == null })
    }

    @Test
    @DisplayName("an inverted date range matches nothing rather than everything")
    fun invertedRangeMatchesNothing() = runTest {
        val query = TransactionQuery(
            from = FakeBallastData.today,
            to = FakeBallastData.today.minusMonths(2),
        )
        assertTrue(query.hasInvalidRange)

        val items = repository().pagedTransactions(workspace, query).asSnapshot()
        assertTrue(items.isEmpty())
    }

    @Test
    @DisplayName("sorting by amount ascending starts at the smallest")
    fun sortByAmountAscending() = runTest {
        val items = repository()
            .pagedTransactions(
                workspace,
                TransactionQuery(sort = TransactionSortKey.AMOUNT, direction = SortDirection.ASC),
            )
            .asSnapshot()

        assertEquals(
            items.map { it.amount }.sorted(),
            items.map { it.amount },
        )
    }

    @Test
    @DisplayName("aggregates cover the filtered set, not the loaded page")
    fun aggregatesCoverEverything() = runTest {
        val repository = repository()
        val query = TransactionQuery(pageSize = 10)

        val aggregates = repository.aggregates(workspace, query).first()
        assertNotNull(aggregates)

        val everything = repository
            .pagedTransactions(workspace, TransactionQuery(pageSize = 1_000))
            .asSnapshot()

        assertEquals(everything.size, aggregates!!.totalCount)
        assertEquals(
            everything.filter { it.type == TransactionType.INCOME }
                .fold(BigDecimal.ZERO) { acc, t -> acc.add(t.amount) },
            aggregates.income,
        )
        assertEquals(aggregates.income.subtract(aggregates.expenses), aggregates.net)
    }

    @Test
    @DisplayName("adding a transaction shows up in the list and in the totals")
    fun addIsVisibleImmediately() = runTest {
        val repository = repository()
        val before = repository.aggregates(workspace, TransactionQuery()).first()!!

        val result = repository.add(
            workspace,
            TransactionDraft(
                type = TransactionType.EXPENSE,
                amount = BigDecimal("42.50"),
                date = FakeBallastData.today,
                description = "Notary fee",
                categoryId = "cat_other",
                counterparty = "Van Damme & Partners",
            ),
        )
        assertTrue(result.isSuccess)

        val after = repository.aggregates(workspace, TransactionQuery()).first()!!

        assertEquals(before.totalCount + 1, after.totalCount)
        assertEquals(before.expenses.add(BigDecimal("42.50")), after.expenses)

        val found = repository
            .pagedTransactions(workspace, TransactionQuery(search = "Notary"))
            .asSnapshot()
        assertEquals(1, found.size)
        assertEquals("Notary fee", found.first().description)
        // The category name and colour are resolved on write, because the list
        // renders a swatch and would otherwise show a colourless row until the
        // next refresh.
        assertEquals("Other", found.first().categoryName)
    }

    @Test
    @DisplayName("bulk recategorise applies to every selected row and can clear a category")
    fun bulkRecategorise() = runTest {
        val repository = repository()
        val page = repository.pagedTransactions(workspace, TransactionQuery(pageSize = 5)).asSnapshot()
        val ids = page.map { it.id }

        assertTrue(repository.setCategory(workspace, ids, "cat_travel").isSuccess)
        var updated = repository.pagedTransactions(workspace, TransactionQuery(pageSize = 5)).asSnapshot()
        assertTrue(updated.take(5).all { it.categoryName == "Travel" })

        assertTrue(repository.setCategory(workspace, ids, null).isSuccess)
        updated = repository.pagedTransactions(workspace, TransactionQuery(pageSize = 5)).asSnapshot()
        assertTrue(updated.take(5).all { it.categoryId == null })
    }

    @Test
    @DisplayName("deleting removes the rows and the count follows")
    fun deleteRemovesRows() = runTest {
        val repository = repository()
        val page = repository.pagedTransactions(workspace, TransactionQuery(pageSize = 3)).asSnapshot()
        val ids = page.map { it.id }

        assertTrue(repository.delete(workspace, ids).isSuccess)

        val remaining = repository
            .pagedTransactions(workspace, TransactionQuery(pageSize = 3))
            .asSnapshot()
        assertTrue(remaining.none { it.id in ids })
    }

    @Test
    @DisplayName("categories and import batches are available for the filter sheets")
    fun lookupsAreExposed() = runTest {
        val repository = repository()

        repository.categories(workspace).test {
            val categories = awaitItem()
            assertTrue(categories.any { it.type == TransactionType.INCOME })
            assertTrue(categories.any { it.type == TransactionType.EXPENSE })
            assertTrue(categories.all { it.color.startsWith("#") })
            cancelAndIgnoreRemainingEvents()
        }

        repository.importBatches(workspace).test {
            assertTrue(awaitItem().isNotEmpty())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
