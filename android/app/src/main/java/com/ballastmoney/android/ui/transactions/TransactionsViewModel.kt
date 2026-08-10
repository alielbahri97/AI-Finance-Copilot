package com.ballastmoney.android.ui.transactions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.TransactionsRepository
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.time.LocalDate
import javax.inject.Inject

/**
 * State holder for the transactions screen.
 *
 * The one non-obvious piece is the query pipeline. [queryState] is the truth the
 * UI renders (so typing appears instantly), while [appliedQuery] is what the
 * repository sees; the two differ only for the 350 ms search debounce, matching
 * the web app's `useDebouncedValue(search, 350)`. Everything else — type,
 * category, dates, amounts, sort, page size — applies immediately, and because
 * the paged flow is a `flatMapLatest` over the applied query, any change tears
 * down the old `PagingData` and starts a fresh one from page zero.
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@HiltViewModel
class TransactionsViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val transactionsRepository: TransactionsRepository,
) : ViewModel() {

    private val queryState = MutableStateFlow(TransactionQuery())
    private val localState = MutableStateFlow(LocalState())

    private val messageChannel = Channel<TransactionsMessage>(Channel.BUFFERED)

    /** One-shot confirmations and failures. Collect once, from the screen. */
    val messages: Flow<TransactionsMessage> = messageChannel.receiveAsFlow()

    private val session: StateFlow<SessionBootstrap?> =
        sessionRepository.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val workspaceId: Flow<String?> =
        session.map { it?.currentWorkspace?.id }.distinctUntilChanged()

    /**
     * Guard for the debounce: only a *change to the search text* is worth
     * waiting on. `mapLatest` cancels the pending delay when the next keystroke
     * arrives, which is the whole debounce.
     */
    private var appliedSearch: String = ""

    private val appliedQuery: StateFlow<TransactionQuery> = queryState
        .mapLatest { query ->
            if (query.search != appliedSearch) {
                delay(SEARCH_DEBOUNCE_MS)
            }
            appliedSearch = query.search
            query
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, TransactionQuery())

    private val requests: Flow<Request?> =
        combine(workspaceId, appliedQuery) { id, query -> id?.let { Request(it, query) } }
            .distinctUntilChanged()

    val transactions: Flow<PagingData<Transaction>> = requests
        .flatMapLatest { request ->
            if (request == null) {
                flowOf(PagingData.empty<Transaction>())
            } else {
                transactionsRepository.pagedTransactions(request.workspaceId, request.query)
            }
        }
        .cachedIn(viewModelScope)

    val aggregates: StateFlow<TransactionAggregates?> = requests
        .flatMapLatest { request ->
            if (request == null) {
                flowOf<TransactionAggregates?>(null)
            } else {
                transactionsRepository.aggregates(request.workspaceId, request.query)
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(SUBSCRIPTION_TIMEOUT_MS), null)

    val categories: StateFlow<List<Category>> = workspaceId
        .flatMapLatest { id ->
            if (id == null) flowOf(emptyList<Category>()) else transactionsRepository.categories(id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(SUBSCRIPTION_TIMEOUT_MS), emptyList())

    val importBatches: StateFlow<List<ImportBatch>> = workspaceId
        .flatMapLatest { id ->
            if (id == null) flowOf(emptyList<ImportBatch>()) else transactionsRepository.importBatches(id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(SUBSCRIPTION_TIMEOUT_MS), emptyList())

    val uiState: StateFlow<TransactionsUiState> =
        combine(queryState, aggregates, categories, importBatches, session) { query, totals, cats, batches, bootstrap ->
            val workspace = bootstrap?.currentWorkspace
            TransactionsUiState(
                query = query,
                aggregates = totals,
                categories = cats,
                importBatches = batches,
                formatter = formatterFor(workspace?.currency),
                currencyCode = workspace?.currency ?: FALLBACK_CURRENCY,
                permissions = bootstrap?.permissions ?: emptySet(),
                hasSession = bootstrap != null,
            )
        }
            .combine(localState) { base, local ->
                base.copy(
                    selection = local.selection,
                    sheet = local.sheet,
                    categoryTarget = local.categoryTarget,
                    isMutating = local.isMutating,
                )
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(SUBSCRIPTION_TIMEOUT_MS), TransactionsUiState())

    // ---------------------------------------------------------------- filters

    fun onSearchChange(value: String) = updateQuery { it.copy(search = value) }

    fun onTypeChange(type: TransactionType?) = updateQuery { it.copy(type = type) }

    /** Pass [TransactionQuery.UNCATEGORIZED] for "no category", null for "any". */
    fun onCategoryChange(categoryId: String?) = updateQuery { it.copy(categoryId = categoryId) }

    fun onBatchChange(importBatchId: String?) = updateQuery { it.copy(importBatchId = importBatchId) }

    fun onDateRangeChange(from: LocalDate?, to: LocalDate?) = updateQuery { it.copy(from = from, to = to) }

    fun onAmountRangeChange(minAmount: BigDecimal?, maxAmount: BigDecimal?) =
        updateQuery { it.copy(minAmount = minAmount, maxAmount = maxAmount) }

    /** Same key toggles the direction; a new key starts at its own default. */
    fun onSortChange(sort: TransactionSortKey) = updateQuery { current ->
        if (current.sort == sort) {
            current.copy(direction = current.direction.toggled())
        } else {
            current.copy(sort = sort, direction = sort.defaultDirection)
        }
    }

    fun onPageSizeChange(pageSize: Int) = updateQuery { it.copy(pageSize = pageSize) }

    fun clearFilters() {
        updateQuery { it.cleared() }
        dismissSheet()
    }

    /**
     * Applies a whole query at once (the filter sheet's Apply button). The live
     * search text wins over whatever the sheet was holding, because the search
     * field stays visible and editable behind the sheet.
     */
    fun applyQuery(query: TransactionQuery) {
        queryState.update { current -> query.copy(search = current.search) }
        dismissSheet()
    }

    /** The nudge banner: show the uncategorized rows, biggest first. */
    fun startTeaching() {
        queryState.update { current ->
            current.copy(
                categoryId = TransactionQuery.UNCATEGORIZED,
                sort = TransactionSortKey.AMOUNT,
                direction = SortDirection.DESC,
            )
        }
        dismissSheet()
    }

    // ----------------------------------------------------------------- sheets

    fun openFilters() = localState.update { it.copy(sheet = TransactionsSheet.Filters) }

    fun openSort() = localState.update { it.copy(sheet = TransactionsSheet.Sort) }

    /** A null [transaction] targets the current selection. */
    fun openCategoryPicker(transaction: Transaction?) = localState.update {
        it.copy(sheet = TransactionsSheet.CategoryPicker(transaction?.id), categoryTarget = transaction)
    }

    fun openEditor(existing: Transaction?) = localState.update {
        it.copy(sheet = TransactionsSheet.AddEdit(existing))
    }

    fun dismissSheet() = localState.update { it.copy(sheet = null, categoryTarget = null) }

    // -------------------------------------------------------------- selection

    fun toggleSelection(id: String) = localState.update { current ->
        val next = if (id in current.selection) current.selection - id else current.selection + id
        current.copy(selection = next)
    }

    /** Adds every id currently loaded in the list; ids, not indices, so paging cannot shift it. */
    fun selectAllOnScreen(ids: List<String>) = localState.update { it.copy(selection = it.selection + ids) }

    fun clearSelection() = localState.update { it.copy(selection = emptySet()) }

    // ----------------------------------------------------------------- writes

    /**
     * Routes the category picker's choice: to one row when it was opened from a
     * row, otherwise to everything selected.
     */
    fun pickCategory(categoryId: String?) {
        val target = (localState.value.sheet as? TransactionsSheet.CategoryPicker)?.transactionId
        if (target != null) {
            setCategoryFor(target, categoryId)
        } else {
            bulkSetCategory(categoryId)
        }
    }

    fun setCategoryFor(transactionId: String, categoryId: String?) {
        mutate(
            action = { workspace -> transactionsRepository.setCategory(workspace, listOf(transactionId), categoryId) },
            onSuccess = {
                dismissSheet()
                notify("Category updated")
            },
        )
    }

    fun bulkSetCategory(categoryId: String?) {
        val ids = cappedSelection() ?: return
        mutate(
            action = { workspace -> transactionsRepository.setCategory(workspace, ids, categoryId) },
            onSuccess = {
                clearSelection()
                dismissSheet()
                notify("Category updated on ${ids.size} transactions")
            },
        )
    }

    fun bulkDelete() {
        val ids = cappedSelection() ?: return
        mutate(
            action = { workspace -> transactionsRepository.delete(workspace, ids) },
            onSuccess = {
                clearSelection()
                dismissSheet()
                notify("Deleted ${ids.size} transactions")
            },
        )
    }

    fun deleteOne(id: String) {
        mutate(
            action = { workspace -> transactionsRepository.delete(workspace, listOf(id)) },
            onSuccess = {
                localState.update { it.copy(selection = it.selection - id) }
                dismissSheet()
                notify("Transaction deleted")
            },
        )
    }

    fun saveDraft(draft: TransactionDraft, existingId: String?) {
        mutate(
            action = { workspace ->
                if (existingId == null) {
                    transactionsRepository.add(workspace, draft)
                } else {
                    transactionsRepository.update(workspace, existingId, draft)
                }
            },
            onSuccess = {
                dismissSheet()
                notify(if (existingId == null) "Transaction added" else "Transaction updated")
            },
        )
    }

    // ---------------------------------------------------------------- helpers

    private fun updateQuery(transform: (TransactionQuery) -> TransactionQuery) {
        queryState.update(transform)
    }

    /**
     * The web API rejects bulk payloads over 1000 ids, so the client trims
     * rather than letting the server fail the whole call.
     */
    private fun cappedSelection(): List<String>? {
        val selection = localState.value.selection
        if (selection.isEmpty()) {
            notify("Select at least one transaction first.", isError = true)
            return null
        }
        val ids = selection.toList()
        if (ids.size <= MAX_BULK_IDS) return ids
        notify("Bulk actions cover $MAX_BULK_IDS transactions at a time, so only the first $MAX_BULK_IDS were included.")
        return ids.take(MAX_BULK_IDS)
    }

    private fun mutate(
        action: suspend (workspaceId: String) -> Result<Unit>,
        onSuccess: () -> Unit,
    ) {
        val workspace = session.value?.currentWorkspace?.id
        if (workspace == null) {
            notify("We're still loading your workspace. Try again in a moment.", isError = true)
            return
        }
        viewModelScope.launch {
            localState.update { it.copy(isMutating = true) }
            val result = action(workspace)
            localState.update { it.copy(isMutating = false) }
            result.fold(
                onSuccess = { onSuccess() },
                onFailure = { error ->
                    notify(error.message?.takeIf { it.isNotBlank() } ?: "That didn't save. Try again.", isError = true)
                },
            )
        }
    }

    private fun notify(text: String, isError: Boolean = false) {
        messageChannel.trySend(TransactionsMessage(text, isError))
    }

    /**
     * A [MoneyFormatter] builds a [java.text.NumberFormat], and it has no
     * identity, so recreating one per emission would both waste work and make
     * every ui state unequal to the last. One per currency is enough.
     */
    private var cachedFormatter: Pair<String, MoneyFormatter>? = null

    private fun formatterFor(currency: String?): MoneyFormatter {
        val code = currency?.takeIf { it.isNotBlank() } ?: FALLBACK_CURRENCY
        cachedFormatter?.let { (cachedCode, formatter) -> if (cachedCode == code) return formatter }
        return MoneyFormatter(code).also { cachedFormatter = code to it }
    }

    private data class Request(
        val workspaceId: String,
        val query: TransactionQuery,
    )

    /** Purely local UI concerns; nothing here comes from or goes to the server. */
    private data class LocalState(
        val selection: Set<String> = emptySet(),
        val sheet: TransactionsSheet? = null,
        val categoryTarget: Transaction? = null,
        val isMutating: Boolean = false,
    )

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 350L
        const val SUBSCRIPTION_TIMEOUT_MS = 5_000L
        const val MAX_BULK_IDS = 1000
    }
}
