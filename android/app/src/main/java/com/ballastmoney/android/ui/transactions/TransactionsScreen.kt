package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemContentType
import androidx.paging.compose.itemKey
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastAlertDialog
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastIconButton
import com.ballastmoney.android.designsystem.component.BallastTopBar
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.ErrorState
import com.ballastmoney.android.designsystem.component.ListRowSkeleton
import com.ballastmoney.android.designsystem.component.LoadingState
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The transactions screen.
 *
 * [contentPadding] carries the window insets the shell has already worked out.
 * It is a parameter rather than something read from `WindowInsets` here because
 * the shell owns the bottom bar and rail, and from API 36 the edge-to-edge
 * opt-out is gone, so *something* has to be told about the system bars — better
 * one owner than two guesses. Nothing in here assumes a portrait phone: the
 * content is width-capped and centred, so a 600dp+ landscape tablet gets a
 * readable column instead of a stretched one.
 */
@Composable
fun TransactionsScreen(
    onNavigateToImport: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    viewModel: TransactionsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val items = viewModel.transactions.collectAsLazyPagingItems()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(viewModel, snackbarHostState) {
        viewModel.messages.collect { message ->
            snackbarHostState.showSnackbar(message.text)
        }
    }

    val actions = remember(viewModel, onNavigateToImport) {
        TransactionsActions(
            onSearchChange = viewModel::onSearchChange,
            onApplyQuery = viewModel::applyQuery,
            onClearFilters = viewModel::clearFilters,
            onSortChange = viewModel::onSortChange,
            onOpenFilters = viewModel::openFilters,
            onOpenSort = viewModel::openSort,
            onOpenEditor = viewModel::openEditor,
            onOpenCategoryPicker = viewModel::openCategoryPicker,
            onDismissSheet = viewModel::dismissSheet,
            onPickCategory = viewModel::pickCategory,
            onToggleSelection = viewModel::toggleSelection,
            onSelectAllOnScreen = viewModel::selectAllOnScreen,
            onClearSelection = viewModel::clearSelection,
            onDeleteSelected = viewModel::bulkDelete,
            onDeleteOne = viewModel::deleteOne,
            onSaveDraft = viewModel::saveDraft,
            onStartTeaching = viewModel::startTeaching,
            onNavigateToImport = onNavigateToImport,
        )
    }

    TransactionsContent(
        state = state,
        paged = items,
        actions = actions,
        modifier = modifier,
        contentPadding = contentPadding,
        snackbarHostState = snackbarHostState,
    )
}

@Composable
internal fun TransactionsContent(
    state: TransactionsUiState,
    /** Named `paged` so it cannot shadow `LazyListScope.items` below. */
    paged: LazyPagingItems<Transaction>,
    actions: TransactionsActions,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val layoutDirection = LocalLayoutDirection.current
    val startInset = contentPadding.calculateStartPadding(layoutDirection)
    val endInset = contentPadding.calculateEndPadding(layoutDirection)
    val topInset = contentPadding.calculateTopPadding()
    val bottomInset = contentPadding.calculateBottomPadding()

    var confirmSelectionDelete by remember { mutableStateOf(false) }
    var confirmSingleDelete by remember { mutableStateOf<String?>(null) }

    // Read paging state here, in composition, rather than inside the LazyColumn
    // content lambda, where state reads do not reliably trigger recomposition.
    val refreshState = paged.loadState.refresh
    val appendState = paged.loadState.append
    val itemCount = paged.itemCount
    val loadedTransactions = paged.itemSnapshotList.items
    val uncategorizedLoaded = loadedTransactions.count { it.isUncategorized }
    val listState = rememberLazyListState()

    val gated = state.hasSession && !state.canView

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .widthIn(max = MAX_CONTENT_WIDTH)
                .fillMaxSize()
                .align(Alignment.TopCenter)
                .padding(start = startInset, end = endInset, top = topInset),
        ) {
            if (state.isSelectionMode) {
                TransactionsSelectionBar(
                    selectedCount = state.selection.size,
                    canSelectAll = loadedTransactions.size > state.selection.size,
                    onClose = actions.onClearSelection,
                    onSelectAll = { actions.onSelectAllOnScreen(loadedTransactions.map { it.id }) },
                    onSetCategory = { actions.onOpenCategoryPicker(null) },
                    onDelete = { confirmSelectionDelete = true },
                )
            } else {
                TransactionsHeader(state = state, actions = actions)
            }

            if (gated) {
                ErrorState(
                    title = "You don't have access to transactions",
                    description = "Ask a workspace owner or admin for the View transactions permission, " +
                        "and this list will fill in.",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(BallastSpacing.lg),
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = BallastSpacing.md,
                        end = BallastSpacing.md,
                        top = BallastSpacing.sm,
                        bottom = bottomInset + BallastSpacing.xxl,
                    ),
                    verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
                ) {
                    item(key = "aggregates") {
                        TransactionAggregateTiles(
                            aggregates = state.aggregates,
                            formatter = state.formatter,
                            currencyCode = state.currencyCode,
                        )
                    }

                    item(key = "toolbar") {
                        TransactionsToolbar(state = state, actions = actions)
                    }

                    if (state.canEdit && uncategorizedLoaded > 0 &&
                        state.query.categoryId != TransactionQuery.UNCATEGORIZED
                    ) {
                        item(key = "nudge") {
                            UncategorizedNudge(
                                count = uncategorizedLoaded,
                                onStartTeaching = actions.onStartTeaching,
                            )
                        }
                    }

                    when {
                        refreshState is LoadState.Loading && itemCount == 0 -> {
                            item(key = "loading") {
                                ListRowSkeleton(rows = 6)
                            }
                        }

                        refreshState is LoadState.Error -> {
                            item(key = "refresh-error") {
                                ErrorState(
                                    title = "We couldn't load your transactions",
                                    description = refreshState.error.message?.takeIf { it.isNotBlank() }
                                        ?: "Check your connection and try again.",
                                    modifier = Modifier.fillMaxWidth(),
                                    onRetry = { paged.retry() },
                                )
                            }
                        }

                        itemCount == 0 -> {
                            item(key = "empty") {
                                TransactionsEmptyState(state = state, actions = actions)
                            }
                        }

                        else -> {
                            items(
                                count = itemCount,
                                key = paged.itemKey { it.id },
                                contentType = paged.itemContentType { TRANSACTION_CONTENT_TYPE },
                            ) { index ->
                                val transaction = paged[index]
                                if (transaction == null) {
                                    TransactionRowPlaceholder()
                                } else {
                                    TransactionRow(
                                        transaction = transaction,
                                        formatter = state.formatter,
                                        selected = transaction.id in state.selection,
                                        selectionMode = state.isSelectionMode,
                                        onClick = {
                                            if (state.isSelectionMode) {
                                                actions.onToggleSelection(transaction.id)
                                            } else if (state.canEdit) {
                                                actions.onOpenCategoryPicker(transaction)
                                            }
                                        },
                                        onLongClick = {
                                            if (state.canEdit) actions.onToggleSelection(transaction.id)
                                        },
                                    )
                                }
                            }

                            when (appendState) {
                                // Height-capped: LoadingState fills whatever it
                                // is given, and a lazy item is given the whole
                                // viewport.
                                is LoadState.Loading -> item(key = "append-loading") {
                                    LoadingState(modifier = Modifier.height(72.dp))
                                }

                                is LoadState.Error -> item(key = "append-error") {
                                    BallastAlert(
                                        title = "We couldn't load more transactions",
                                        modifier = Modifier.fillMaxWidth(),
                                        description = appendState.error.message?.takeIf { it.isNotBlank() },
                                        variant = AlertVariant.DESTRUCTIVE,
                                        action = {
                                            BallastButton(
                                                text = "Retry",
                                                onClick = { paged.retry() },
                                                variant = ButtonVariant.OUTLINE,
                                                size = ButtonSize.SMALL,
                                            )
                                        },
                                    )
                                }

                                else -> Unit
                            }
                        }
                    }
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(
                    start = startInset + BallastSpacing.md,
                    end = endInset + BallastSpacing.md,
                    bottom = bottomInset + BallastSpacing.md,
                ),
        )
    }

    TransactionsSheetHost(
        state = state,
        actions = actions,
        onRequestDeleteOne = { id -> confirmSingleDelete = id },
    )

    if (confirmSelectionDelete) {
        val count = state.selection.size
        BallastAlertDialog(
            onDismissRequest = { confirmSelectionDelete = false },
            title = if (count == 1) "Delete this transaction?" else "Delete $count transactions?",
            confirmText = "Delete",
            onConfirm = {
                confirmSelectionDelete = false
                actions.onDeleteSelected()
            },
            description = "This removes them from the workspace for everyone. It cannot be undone.",
            dismissText = "Cancel",
            destructive = true,
            loading = state.isMutating,
        )
    }

    confirmSingleDelete?.let { id ->
        BallastAlertDialog(
            onDismissRequest = { confirmSingleDelete = null },
            title = "Delete this transaction?",
            confirmText = "Delete",
            onConfirm = {
                confirmSingleDelete = null
                actions.onDeleteOne(id)
            },
            description = "This removes it from the workspace for everyone. It cannot be undone.",
            dismissText = "Cancel",
            destructive = true,
            loading = state.isMutating,
        )
    }
}

@Composable
private fun TransactionsHeader(
    state: TransactionsUiState,
    actions: TransactionsActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        BallastTopBar(
            title = "Transactions",
            actions = {
                if (state.canEdit) {
                    BallastIconButton(
                        icon = Icons.Filled.Add,
                        contentDescription = "Add transaction",
                        onClick = { actions.onOpenEditor(null) },
                    )
                    BallastIconButton(
                        icon = Icons.Filled.FileUpload,
                        contentDescription = "Import",
                        onClick = actions.onNavigateToImport,
                    )
                }
            },
        )
        // Not the top bar's `subtitle` slot: that one is a single ellipsized
        // line, and this sentence is the screen's whole invitation to label
        // things, so it is allowed to wrap.
        Text(
            text = "Tap a row to label it \u2014 or spend five minutes teaching Ballast the biggest ones.",
            style = BallastTextStyles.mutedBody,
            color = MaterialTheme.ballastColors.mutedForeground,
            modifier = Modifier.padding(
                start = BallastSpacing.lg,
                end = BallastSpacing.lg,
                bottom = BallastSpacing.sm,
            ),
        )
    }
}

/**
 * The contextual action bar. Hand-rolled rather than a top bar variant so the
 * count, the close affordance and the three actions can sit at the same optical
 * weight without fighting the title slot.
 */
@Composable
private fun TransactionsSelectionBar(
    selectedCount: Int,
    canSelectAll: Boolean,
    onClose: () -> Unit,
    onSelectAll: () -> Unit,
    onSetCategory: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = BallastSpacing.sm, vertical = BallastSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
        ) {
            BallastIconButton(
                icon = Icons.Filled.Close,
                contentDescription = "Clear selection",
                onClick = onClose,
            )
            Text(
                text = "$selectedCount selected",
                style = BallastTextStyles.cardTitle,
                modifier = Modifier.weight(1f),
            )
            BallastIconButton(
                icon = Icons.Filled.DoneAll,
                contentDescription = "Select everything loaded",
                onClick = onSelectAll,
                enabled = canSelectAll,
            )
            BallastIconButton(
                icon = Icons.Filled.Label,
                contentDescription = "Set category",
                onClick = onSetCategory,
            )
            BallastIconButton(
                icon = Icons.Filled.Delete,
                contentDescription = "Delete",
                onClick = onDelete,
            )
        }
    }
}

@Composable
private fun TransactionsEmptyState(
    state: TransactionsUiState,
    actions: TransactionsActions,
    modifier: Modifier = Modifier,
) {
    if (state.query.hasActiveFilters) {
        EmptyState(
            icon = Icons.Filled.FilterList,
            title = "Nothing matches these filters",
            description = "Widen the date range, pick another category, or start over.",
            modifier = modifier.fillMaxWidth(),
            primaryAction = {
                BallastButton(text = "Clear filters", onClick = actions.onClearFilters)
            },
        )
    } else {
        EmptyState(
            icon = Icons.Filled.ReceiptLong,
            title = "No transactions yet",
            description = "Import a bank statement to bring in months of history at once, " +
                "or add a single entry by hand.",
            modifier = modifier.fillMaxWidth(),
            primaryAction = {
                BallastButton(text = "Import statement", onClick = actions.onNavigateToImport)
            },
            secondaryAction = {
                BallastButton(
                    text = "Add transaction",
                    onClick = { actions.onOpenEditor(null) },
                    variant = ButtonVariant.OUTLINE,
                )
            },
        )
    }
}

@Composable
private fun TransactionsSheetHost(
    state: TransactionsUiState,
    actions: TransactionsActions,
    onRequestDeleteOne: (String) -> Unit,
) {
    when (val sheet = state.sheet) {
        null -> Unit

        TransactionsSheet.Filters -> TransactionFilterSheet(
            state = state,
            onDismiss = actions.onDismissSheet,
            onApply = actions.onApplyQuery,
        )

        TransactionsSheet.Sort -> TransactionSortSheet(
            query = state.query,
            onDismiss = actions.onDismissSheet,
            onSelect = actions.onSortChange,
        )

        is TransactionsSheet.CategoryPicker -> TransactionCategorySheet(
            transaction = state.categoryTarget,
            selectionCount = state.selection.size,
            categories = state.categories,
            formatter = state.formatter,
            onDismiss = actions.onDismissSheet,
            onPick = actions.onPickCategory,
        )

        is TransactionsSheet.AddEdit -> TransactionEditorSheet(
            existing = sheet.existing,
            categories = state.categories,
            formatter = state.formatter,
            isSaving = state.isMutating,
            onDismiss = actions.onDismissSheet,
            onSave = actions.onSaveDraft,
            onRequestDelete = onRequestDeleteOne,
        )
    }
}

private const val TRANSACTION_CONTENT_TYPE = "transaction"

private val MAX_CONTENT_WIDTH = 720.dp
