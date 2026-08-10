package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastListRow
import com.ballastmoney.android.designsystem.component.BallastTabs
import com.ballastmoney.android.designsystem.component.BallastTextField
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.CategoryDot
import java.time.LocalDate
import java.time.ZoneId

/**
 * Add or edit one transaction.
 *
 * The web app has no edit form — it only lets you change a row's category inline
 * — so the edit half of this is new. One sheet serves both because the fields are
 * identical; only the title, the seed values and the repository call differ.
 */
@Composable
internal fun TransactionEditorSheet(
    existing: Transaction?,
    categories: List<Category>,
    formatter: MoneyFormatter,
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onSave: (TransactionDraft, String?) -> Unit,
    onRequestDelete: (String) -> Unit,
) {
    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = if (existing == null) "Add transaction" else "Edit transaction",
        description = if (existing == null) {
            "Record a new income or expense."
        } else {
            "Change any detail and save it again."
        },
    ) {
        TransactionEditorSheetContent(
            existing = existing,
            categories = categories,
            formatter = formatter,
            isSaving = isSaving,
            onSave = onSave,
            onRequestDelete = onRequestDelete,
        )
    }
}

@Composable
internal fun TransactionEditorSheetContent(
    existing: Transaction?,
    categories: List<Category>,
    formatter: MoneyFormatter,
    isSaving: Boolean,
    onSave: (TransactionDraft, String?) -> Unit,
    modifier: Modifier = Modifier,
    onRequestDelete: (String) -> Unit = {},
) {
    val formKey = existing?.id ?: NEW_TRANSACTION_KEY

    // Expense first, and the default, because that is the overwhelming majority
    // of what anyone types in by hand.
    var typeIndex by rememberSaveable(formKey) {
        mutableStateOf(if (existing?.type == TransactionType.INCOME) 1 else 0)
    }
    var amountText by rememberSaveable(formKey) {
        mutableStateOf(existing?.amount?.toPlainString().orEmpty())
    }
    var dateText by rememberSaveable(formKey) {
        mutableStateOf(existing?.let { localDateOf(it).toString() } ?: LocalDate.now().toString())
    }
    var descriptionText by rememberSaveable(formKey) { mutableStateOf(existing?.description.orEmpty()) }
    var categoryId by rememberSaveable(formKey) { mutableStateOf(existing?.categoryId) }
    var showErrors by rememberSaveable(formKey) { mutableStateOf(false) }

    val type = if (typeIndex == 1) TransactionType.INCOME else TransactionType.EXPENSE
    val options = categories.filter { it.type == type }

    val amountError = amountValidationError(amountText)
    val dateError = dateValidationError(dateText)
    val descriptionError = descriptionValidationError(descriptionText)

    SheetBody(modifier = modifier) {
        BallastTabs(
            tabs = listOf("Expense", "Income"),
            selectedIndex = typeIndex,
            onSelect = { index ->
                if (index != typeIndex) {
                    typeIndex = index
                    // A category belongs to one type, so it cannot survive a flip.
                    categoryId = null
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )

        BallastTextField(
            value = amountText,
            onValueChange = { amountText = it },
            modifier = Modifier.fillMaxWidth(),
            label = "Amount",
            placeholder = "0.00",
            supportingText = if (showErrors) amountError else null,
            isError = showErrors && amountError != null,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )

        BallastTextField(
            value = dateText,
            onValueChange = { dateText = it },
            modifier = Modifier.fillMaxWidth(),
            label = "Date",
            placeholder = "YYYY-MM-DD",
            supportingText = when {
                showErrors && dateError != null -> dateError
                else -> parseDateInput(dateText)?.let { formatter.formatDate(it) }
            },
            isError = showErrors && dateError != null,
            singleLine = true,
        )

        SheetSectionLabel(text = "Category")
        SheetOptionList {
            BallastListRow(
                title = "Uncategorized",
                subtitle = "Ballast can suggest one later",
                selected = categoryId == null,
                onClick = { categoryId = null },
            )
            options.forEach { category ->
                BallastListRow(
                    title = category.name,
                    onClick = { categoryId = category.id },
                    selected = categoryId == category.id,
                    leading = { CategoryDot(colorHex = category.color) },
                )
            }
        }

        BallastTextField(
            value = descriptionText,
            onValueChange = { value ->
                descriptionText = if (value.length > MAX_DESCRIPTION_LENGTH) {
                    value.take(MAX_DESCRIPTION_LENGTH)
                } else {
                    value
                }
            },
            modifier = Modifier.fillMaxWidth(),
            label = "Description",
            placeholder = "e.g. Weekly groceries",
            supportingText = if (showErrors) descriptionError else null,
            isError = showErrors && descriptionError != null,
            singleLine = false,
            minLines = 2,
        )

        BallastButton(
            text = "Save transaction",
            onClick = {
                showErrors = true
                val amount = parseAmountInput(amountText)
                val date = parseDateInput(dateText)
                if (amountError == null && dateError == null && descriptionError == null &&
                    amount != null && date != null
                ) {
                    onSave(
                        TransactionDraft(
                            type = type,
                            amount = amount,
                            date = date,
                            description = descriptionText.trim(),
                            categoryId = categoryId,
                            // Not editable here; keep whatever the import or bank feed set.
                            counterparty = existing?.counterparty,
                        ),
                        existing?.id,
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
            loading = isSaving,
            fillMaxWidth = true,
        )

        if (existing != null) {
            BallastButton(
                text = "Delete transaction",
                onClick = { onRequestDelete(existing.id) },
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.DESTRUCTIVE,
                enabled = !isSaving,
                fillMaxWidth = true,
            )
        }
    }
}

/**
 * Transactions carry an [java.time.Instant]; the form edits a calendar day. The
 * device zone is the right one to convert in, because that is the day the user
 * believes the money moved.
 */
private fun localDateOf(transaction: Transaction): LocalDate =
    transaction.date.atZone(ZoneId.systemDefault()).toLocalDate()

private const val NEW_TRANSACTION_KEY = "new"
