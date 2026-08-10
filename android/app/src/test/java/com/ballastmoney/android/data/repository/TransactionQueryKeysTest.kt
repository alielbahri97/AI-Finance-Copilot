package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.time.LocalDate

/**
 * The cache key three tables are partitioned by.
 *
 * A collision here does not look like a bug in this file. It looks like the
 * transactions list showing rows that do not match the filter, or two orderings
 * interleaved, somewhere far away and only for the user whose search text
 * happened to contain the delimiter.
 */
class TransactionQueryKeysTest {

    private val workspace = "ws_9c1f"

    @Test
    @DisplayName("equal queries produce the same key, whichever way they were built")
    fun equalQueriesAgree() {
        val one = TransactionQuery(
            search = "colruyt",
            type = TransactionType.EXPENSE,
            categoryId = "cat_groceries",
            from = LocalDate.of(2026, 1, 1),
            to = LocalDate.of(2026, 8, 10),
            minAmount = BigDecimal("10.00"),
            maxAmount = BigDecimal("500.00"),
            sort = TransactionSortKey.AMOUNT,
            direction = SortDirection.ASC,
        )
        val other = one.copy()

        assertEquals(one, other)
        assertEquals(transactionQueryKey(workspace, one), transactionQueryKey(workspace, other))
    }

    @Test
    @DisplayName("surrounding whitespace in the search does not fork the cache")
    fun searchIsTrimmed() {
        assertEquals(
            transactionQueryKey(workspace, TransactionQuery(search = "colruyt")),
            transactionQueryKey(workspace, TransactionQuery(search = "  colruyt  ")),
        )
    }

    @Test
    @DisplayName("a page size the server would not accept keys as the size it will serve")
    fun pageSizeIsKeyedOnTheEffectiveValue() {
        // 30 is not one of the contract's three sizes; the request is clamped
        // up to 50, so both must share a cache entry.
        assertEquals(
            transactionQueryKey(workspace, TransactionQuery(pageSize = 50)),
            transactionQueryKey(workspace, TransactionQuery(pageSize = 30)),
        )
        assertNotEquals(
            transactionQueryKey(workspace, TransactionQuery(pageSize = 25)),
            transactionQueryKey(workspace, TransactionQuery(pageSize = 50)),
        )
    }

    @Test
    @DisplayName("the workspace is part of the key, so two workspaces cannot share an ordering")
    fun workspaceIsPartOfTheKey() {
        assertNotEquals(
            transactionQueryKey("ws_one", TransactionQuery()),
            transactionQueryKey("ws_two", TransactionQuery()),
        )
    }

    @Test
    @DisplayName("no two different queries collide, including ones that share their characters")
    fun differentQueriesNeverCollide() {
        val queries = listOf(
            TransactionQuery(),
            TransactionQuery(search = "a"),
            TransactionQuery(search = "b"),
            // The pair that a naive delimited join gets wrong: the delimiter
            // and the field separator smuggled into a value.
            TransactionQuery(search = "a|cat:1:b"),
            TransactionQuery(search = "a", categoryId = "b"),
            TransactionQuery(search = "ab"),
            TransactionQuery(categoryId = "ab"),
            TransactionQuery(type = TransactionType.INCOME),
            TransactionQuery(type = TransactionType.EXPENSE),
            TransactionQuery(categoryId = TransactionQuery.UNCATEGORIZED),
            TransactionQuery(importBatchId = "b_jan"),
            TransactionQuery(from = LocalDate.of(2026, 1, 1)),
            TransactionQuery(to = LocalDate.of(2026, 1, 1)),
            TransactionQuery(minAmount = BigDecimal("10.00")),
            TransactionQuery(maxAmount = BigDecimal("10.00")),
            // Different scales are different queries by the domain model's own
            // equality, so they are allowed — required, in fact — to differ.
            TransactionQuery(minAmount = BigDecimal("10.0")),
            TransactionQuery(sort = TransactionSortKey.AMOUNT),
            TransactionQuery(sort = TransactionSortKey.DESCRIPTION),
            TransactionQuery(direction = SortDirection.ASC),
            TransactionQuery(pageSize = 25),
            TransactionQuery(pageSize = 100),
        )

        val keys = queries.map { transactionQueryKey(workspace, it) }

        assertEquals(
            queries.size,
            keys.toSet().size,
            "two different queries produced the same key: ${keys.groupBy { it }.filterValues { it.size > 1 }.keys}",
        )
        assertEquals(queries.size, queries.toSet().size, "the fixture itself contains a duplicate query")
    }

    @Test
    @DisplayName("the key is stable across calls, because it is written to disk")
    fun keysAreDeterministic() {
        val query = TransactionQuery(search = "rent", sort = TransactionSortKey.CATEGORY)

        assertEquals(
            transactionQueryKey(workspace, query),
            transactionQueryKey(workspace, query),
        )
    }

    @Test
    @DisplayName("only the three offered page sizes are ever sent")
    fun pageSizesAreClamped() {
        assertEquals(25, allowedPageSize(1))
        assertEquals(25, allowedPageSize(25))
        assertEquals(50, allowedPageSize(26))
        assertEquals(50, allowedPageSize(50))
        assertEquals(100, allowedPageSize(51))
        assertEquals(100, allowedPageSize(100))
        assertEquals(100, allowedPageSize(1_000))
        // Nonsense in, something the server accepts out: a zero or negative
        // size is a client bug, and a documented 400 is a worse answer to it
        // than the smallest real page.
        assertEquals(25, allowedPageSize(0))
        assertEquals(25, allowedPageSize(-10))
    }
}
