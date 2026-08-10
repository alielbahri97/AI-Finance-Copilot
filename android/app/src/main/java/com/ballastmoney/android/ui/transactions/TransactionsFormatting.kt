package com.ballastmoney.android.ui.transactions

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType
import java.math.BigDecimal
import java.text.NumberFormat
import java.time.LocalDate

/** Digit grouping in the workspace's currency locale, e.g. `1,204` or `1.204`. */
internal fun formatCount(count: Int, currencyCode: String): String =
    NumberFormat.getIntegerInstance(MoneyFormatter.localeForCurrency(currencyCode)).format(count.toLong())

internal fun typeLabel(type: TransactionType): String = when (type) {
    TransactionType.INCOME -> "Income"
    TransactionType.EXPENSE -> "Expense"
}

internal fun sortKeyLabel(sort: TransactionSortKey): String = when (sort) {
    TransactionSortKey.DATE -> "Date"
    TransactionSortKey.DESCRIPTION -> "Description"
    TransactionSortKey.CATEGORY -> "Category"
    TransactionSortKey.AMOUNT -> "Amount"
}

/**
 * Says what the direction *means* for that column rather than just "ascending",
 * which is meaningless for money.
 */
internal fun sortDirectionLabel(sort: TransactionSortKey, direction: SortDirection): String =
    when (sort) {
        TransactionSortKey.DATE ->
            if (direction == SortDirection.DESC) "Newest first" else "Oldest first"

        TransactionSortKey.AMOUNT ->
            if (direction == SortDirection.DESC) "Largest first" else "Smallest first"

        TransactionSortKey.DESCRIPTION, TransactionSortKey.CATEGORY ->
            if (direction == SortDirection.ASC) "A to Z" else "Z to A"
    }

internal fun sortSummary(query: TransactionQuery): String {
    val arrow = if (query.direction == SortDirection.DESC) "\u2193" else "\u2191"
    return "${sortKeyLabel(query.sort)} $arrow"
}

/** A removable chip, paired with the query that results from removing it. */
internal data class ActiveFilterChip(
    val text: String,
    val cleared: TransactionQuery,
)

/**
 * The chips shown under the toolbar. Copy matches the web app's filter summary
 * exactly. Search is not represented here: it has its own field, which already
 * offers a way to clear it.
 */
internal fun activeFilterChips(
    query: TransactionQuery,
    categories: List<Category>,
    importBatches: List<ImportBatch>,
    formatter: MoneyFormatter,
): List<ActiveFilterChip> {
    val chips = mutableListOf<ActiveFilterChip>()

    when (query.type) {
        TransactionType.INCOME -> chips += ActiveFilterChip("Income only", query.copy(type = null))
        TransactionType.EXPENSE -> chips += ActiveFilterChip("Expenses only", query.copy(type = null))
        null -> Unit
    }

    query.categoryId?.let { categoryId ->
        val label = if (categoryId == TransactionQuery.UNCATEGORIZED) {
            "Uncategorized"
        } else {
            categories.firstOrNull { it.id == categoryId }?.name ?: "Category"
        }
        chips += ActiveFilterChip(label, query.copy(categoryId = null))
    }

    query.from?.let { chips += ActiveFilterChip("From ${formatter.formatDate(it)}", query.copy(from = null)) }
    query.to?.let { chips += ActiveFilterChip("To ${formatter.formatDate(it)}", query.copy(to = null)) }
    query.minAmount?.let { chips += ActiveFilterChip("Min ${formatter.format(it)}", query.copy(minAmount = null)) }
    query.maxAmount?.let { chips += ActiveFilterChip("Max ${formatter.format(it)}", query.copy(maxAmount = null)) }

    query.importBatchId?.let { batchId ->
        val label = importBatches.firstOrNull { it.id == batchId }?.fileName ?: "Imported source"
        chips += ActiveFilterChip(label, query.copy(importBatchId = null))
    }

    return chips
}

internal fun importBatchLabel(batch: ImportBatch, formatter: MoneyFormatter): String =
    "${batch.fileName} (${formatter.formatDate(batch.createdAt)})"

// ------------------------------------------------------------------- parsing

private const val ALLOWED_AMOUNT_CHARS = "0123456789.,+-"

/**
 * Folds the many ways people type money into something [BigDecimal] accepts.
 *
 * When both separators appear the last one is the decimal point and the other
 * is grouping, which covers `1,234.56` and `1.234,56` without having to know
 * the user's locale. Deliberately string-only: routing through [Double] would
 * quietly round cents.
 */
internal fun normalizeAmountInput(raw: String): String? {
    val trimmed = raw.trim().replace("\u00A0", "").replace(" ", "")
    if (trimmed.isEmpty()) return null
    if (trimmed.any { it !in ALLOWED_AMOUNT_CHARS }) return null

    val lastComma = trimmed.lastIndexOf(',')
    val lastDot = trimmed.lastIndexOf('.')
    return when {
        lastComma >= 0 && lastDot >= 0 ->
            if (lastComma > lastDot) {
                trimmed.replace(".", "").replace(',', '.')
            } else {
                trimmed.replace(",", "")
            }

        lastComma >= 0 -> trimmed.replace(',', '.')
        else -> trimmed
    }
}

/** Null for anything that is not a plain decimal number. */
internal fun parseAmountInput(raw: String): BigDecimal? {
    val normalized = normalizeAmountInput(raw) ?: return null
    return runCatching { BigDecimal(normalized) }.getOrNull()
}

/** Filter bounds are lenient: unparseable or negative input simply does not filter. */
internal fun parseFilterAmount(raw: String): BigDecimal? =
    parseAmountInput(raw)?.takeIf { it.signum() >= 0 }

/** The editor's amount rules, in the wording the web form uses. */
internal fun amountValidationError(raw: String): String? {
    if (raw.isBlank()) return "Enter an amount"
    val parsed = parseAmountInput(raw) ?: return "Enter a valid number"
    if (parsed.signum() <= 0) return "Amount must be greater than zero"
    return null
}

/** ISO `yyyy-MM-dd`, which is also what `<input type="date">` submits. */
internal fun parseDateInput(raw: String): LocalDate? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    return runCatching { LocalDate.parse(trimmed) }.getOrNull()
}

internal fun dateValidationError(raw: String): String? =
    if (parseDateInput(raw) == null) "Pick a date" else null

internal const val MAX_DESCRIPTION_LENGTH = 500

internal fun descriptionValidationError(raw: String): String? =
    if (raw.trim().isEmpty()) "Enter a description" else null
