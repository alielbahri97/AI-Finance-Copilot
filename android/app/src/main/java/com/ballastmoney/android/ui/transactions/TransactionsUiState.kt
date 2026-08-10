package com.ballastmoney.android.ui.transactions

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType

/**
 * Which modal surface, if any, is open.
 *
 * [CategoryPicker] carries only an id, per the agreed contract; the resolved
 * [Transaction] rides along in [TransactionsUiState.categoryTarget] so the sheet
 * can show its amount and date without reaching back into the paged list, which
 * may have dropped that page by the time the sheet opens.
 */
sealed interface TransactionsSheet {
    data object Filters : TransactionsSheet

    data object Sort : TransactionsSheet

    /** A null [transactionId] means "apply to the current selection". */
    data class CategoryPicker(val transactionId: String?) : TransactionsSheet

    data class AddEdit(val existing: Transaction?) : TransactionsSheet
}

/** Used until the session tells us what the workspace actually trades in. */
internal const val FALLBACK_CURRENCY = "USD"

/**
 * A one-shot confirmation or failure. Delivered over a channel rather than held
 * in state so a rotation does not re-announce "Transaction added".
 */
data class TransactionsMessage(
    val text: String,
    val isError: Boolean = false,
)

data class TransactionsUiState(
    val query: TransactionQuery = TransactionQuery(),
    /** Totals for the whole filtered set. Null until the first load. */
    val aggregates: TransactionAggregates? = null,
    val categories: List<Category> = emptyList(),
    val importBatches: List<ImportBatch> = emptyList(),
    val formatter: MoneyFormatter = MoneyFormatter(FALLBACK_CURRENCY),
    /** ISO 4217, kept alongside [formatter] because the formatter does not expose it. */
    val currencyCode: String = FALLBACK_CURRENCY,
    val permissions: Set<Permission> = emptySet(),
    /** False until the session bootstrap arrives, so the permission gate does not flash. */
    val hasSession: Boolean = false,
    val selection: Set<String> = emptySet(),
    val sheet: TransactionsSheet? = null,
    /** The row the category picker was opened from, if it was opened from a row. */
    val categoryTarget: Transaction? = null,
    /** A write is in flight; drives dialog and button spinners. */
    val isMutating: Boolean = false,
) {
    val isSelectionMode: Boolean get() = selection.isNotEmpty()

    val canView: Boolean get() = Permission.VIEW_TRANSACTIONS in permissions

    val canEdit: Boolean get() = Permission.EDIT_TRANSACTIONS in permissions

    /**
     * Filters owned by the filter sheet. Search is excluded because it has its
     * own always-visible field, so counting it would make the badge argue with
     * what the user sees.
     */
    val activeFilterCount: Int
        get() = listOfNotNull(
            query.type,
            query.categoryId,
            query.importBatchId,
            query.from,
            query.to,
            query.minAmount,
            query.maxAmount,
        ).size

    fun categoriesForType(type: TransactionType): List<Category> = categories.filter { it.type == type }
}

/**
 * Every intent the screen can raise, defaulted to no-ops so previews and tests
 * can build one without a ViewModel.
 */
data class TransactionsActions(
    val onSearchChange: (String) -> Unit = {},
    /**
     * Applies a whole edited query in one go, which is what the filter sheet's
     * Apply does — seven individual intents would reset paging seven times.
     * The ViewModel keeps the live search text.
     */
    val onApplyQuery: (TransactionQuery) -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onSortChange: (TransactionSortKey) -> Unit = {},
    val onOpenFilters: () -> Unit = {},
    val onOpenSort: () -> Unit = {},
    val onOpenEditor: (Transaction?) -> Unit = {},
    val onOpenCategoryPicker: (Transaction?) -> Unit = {},
    val onDismissSheet: () -> Unit = {},
    /** Null clears the category. Applies to the picker's row, or the selection. */
    val onPickCategory: (String?) -> Unit = {},
    val onToggleSelection: (String) -> Unit = {},
    val onSelectAllOnScreen: (List<String>) -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val onDeleteSelected: () -> Unit = {},
    val onDeleteOne: (String) -> Unit = {},
    val onSaveDraft: (TransactionDraft, String?) -> Unit = { _, _ -> },
    /** The nudge banner: filter to uncategorized, biggest first. */
    val onStartTeaching: () -> Unit = {},
    val onNavigateToImport: () -> Unit = {},
)
