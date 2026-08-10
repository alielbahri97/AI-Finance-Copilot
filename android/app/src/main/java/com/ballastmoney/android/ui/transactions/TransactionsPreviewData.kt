package com.ballastmoney.android.ui.transactions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionType
import kotlinx.coroutines.flow.flowOf
import java.math.BigDecimal
import java.time.Instant

/**
 * Fixtures for previews only.
 *
 * They live in this package rather than in `data/` on purpose: nothing outside
 * this screen should be tempted to build a UI on top of made-up numbers.
 */

internal val previewFormatter = MoneyFormatter("EUR")

internal val previewCategories: List<Category> = listOf(
    Category(id = "cat-groceries", name = "Groceries", type = TransactionType.EXPENSE, color = "#f97316"),
    Category(id = "cat-software", name = "Software", type = TransactionType.EXPENSE, color = "#6366f1"),
    Category(id = "cat-rent", name = "Rent", type = TransactionType.EXPENSE, color = "#0ea5e9"),
    Category(id = "cat-transfer-out", name = "Transfer", type = TransactionType.EXPENSE, color = "#94a3b8"),
    Category(id = "cat-clients", name = "Client revenue", type = TransactionType.INCOME, color = "#22c55e"),
    Category(id = "cat-transfer-in", name = "Transfer in", type = TransactionType.INCOME, color = "#94a3b8"),
)

internal val previewImportBatches: List<ImportBatch> = listOf(
    ImportBatch(
        id = "batch-1",
        fileName = "revolut-business-july.csv",
        createdAt = Instant.parse("2026-08-01T09:12:00Z"),
    ),
    ImportBatch(
        id = "batch-2",
        fileName = "ing-june.csv",
        createdAt = Instant.parse("2026-07-02T08:40:00Z"),
    ),
)

internal val previewTransactions: List<Transaction> = listOf(
    Transaction(
        id = "txn-1",
        type = TransactionType.INCOME,
        amount = BigDecimal("4250.00"),
        description = "Invoice 2026-041 — Northwind Studio",
        date = Instant.parse("2026-08-07T09:02:00Z"),
        categoryId = "cat-clients",
        categoryName = "Client revenue",
        categoryColor = "#22c55e",
        counterparty = "Northwind Studio",
        invoiceId = "inv-41",
        invoiceVendor = "Northwind Studio",
    ),
    Transaction(
        id = "txn-2",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("1450.00"),
        description = "Office rent August",
        date = Instant.parse("2026-08-05T06:30:00Z"),
        categoryId = "cat-rent",
        categoryName = "Rent",
        categoryColor = "#0ea5e9",
        counterparty = "Kade Vastgoed",
        importBatchId = "batch-1",
    ),
    Transaction(
        id = "txn-3",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("38.94"),
        description = "ALBERT HEIJN 1234 AMSTERDAM",
        date = Instant.parse("2026-08-04T17:44:00Z"),
        counterparty = "Albert Heijn",
        importBatchId = "batch-1",
    ),
    Transaction(
        id = "txn-4",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("24.00"),
        description = "Figma monthly",
        date = Instant.parse("2026-08-03T11:05:00Z"),
        categoryId = "cat-software",
        categoryName = "Software",
        categoryColor = "#6366f1",
        counterparty = "Figma Inc",
    ),
    Transaction(
        id = "txn-5",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("500.00"),
        description = "To savings",
        date = Instant.parse("2026-08-02T08:00:00Z"),
        categoryId = "cat-transfer-out",
        categoryName = "Transfer",
        categoryColor = "#94a3b8",
    ),
    Transaction(
        id = "txn-6",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("112.35"),
        description = "SEPA OVERBOEKING NL91ABNA0417164300 KANTOORBENODIGDHEDEN",
        date = Instant.parse("2026-08-01T13:21:00Z"),
        importBatchId = "batch-1",
    ),
    Transaction(
        id = "txn-7",
        type = TransactionType.INCOME,
        amount = BigDecimal("500.00"),
        description = "From savings",
        date = Instant.parse("2026-07-31T08:00:00Z"),
        categoryId = "cat-transfer-in",
        categoryName = "Transfer in",
        categoryColor = "#94a3b8",
    ),
)

/** Mostly unlabelled rows, which is what a fresh CSV import actually looks like. */
internal val previewUncategorizedTransactions: List<Transaction> = listOf(
    previewTransactions[2],
    previewTransactions[5],
    Transaction(
        id = "txn-8",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("2199.00"),
        description = "TRANSIP HOSTING JAARFACTUUR",
        date = Instant.parse("2026-07-29T10:00:00Z"),
        importBatchId = "batch-1",
    ),
    Transaction(
        id = "txn-9",
        type = TransactionType.EXPENSE,
        amount = BigDecimal("64.20"),
        description = "NS REIZIGERS BV",
        date = Instant.parse("2026-07-28T07:15:00Z"),
        counterparty = "NS",
        importBatchId = "batch-1",
    ),
    Transaction(
        id = "txn-10",
        type = TransactionType.INCOME,
        amount = BigDecimal("980.00"),
        description = "IDEAL BETALING 8823",
        date = Instant.parse("2026-07-27T15:48:00Z"),
        importBatchId = "batch-1",
    ),
)

internal val previewAggregates = TransactionAggregates(
    income = BigDecimal("5730.00"),
    expenses = BigDecimal("2125.29"),
    net = BigDecimal("3604.71"),
    totalCount = 1284,
)

internal fun previewState(
    query: TransactionQuery = TransactionQuery(),
    aggregates: TransactionAggregates? = previewAggregates,
    selection: Set<String> = emptySet(),
    sheet: TransactionsSheet? = null,
    canEdit: Boolean = true,
): TransactionsUiState = TransactionsUiState(
    query = query,
    aggregates = aggregates,
    categories = previewCategories,
    importBatches = previewImportBatches,
    formatter = previewFormatter,
    currencyCode = "EUR",
    permissions = if (canEdit) {
        setOf(Permission.VIEW_TRANSACTIONS, Permission.EDIT_TRANSACTIONS)
    } else {
        setOf(Permission.VIEW_TRANSACTIONS)
    },
    hasSession = true,
    selection = selection,
    sheet = sheet,
)

/**
 * A settled, single-page [PagingData]. The load states have to be spelled out or
 * a preview renders as a permanent spinner.
 */
internal fun previewPagingData(data: List<Transaction>): PagingData<Transaction> = PagingData.from(
    data,
    LoadStates(
        LoadState.NotLoading(false),
        LoadState.NotLoading(true),
        LoadState.NotLoading(true),
    ),
)

@Composable
internal fun rememberPreviewPagingItems(data: List<Transaction>): LazyPagingItems<Transaction> {
    val flow = remember(data) { flowOf(previewPagingData(data)) }
    return flow.collectAsLazyPagingItems()
}
