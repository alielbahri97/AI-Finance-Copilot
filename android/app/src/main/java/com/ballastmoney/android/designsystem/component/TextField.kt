package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill
import com.ballastmoney.android.designsystem.theme.ballastColors

private val FieldShape = RoundedCornerShape(BallastRadius.md)

/** `h-9` on the web. */
private val FieldMinHeight = 36.dp

/**
 * A text field.
 *
 * Built on [BasicTextField] rather than `OutlinedTextField` for two reasons: the
 * web puts its label *above* the input as a separate element rather than
 * floating it through the border, and the web input is 36dp tall, which is below
 * the 56dp `OutlinedTextField` enforces. Restyling the Material component could
 * not produce either.
 */
@Composable
fun BallastTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    leadingIcon: ImageVector? = null,
    trailingIcon: @Composable (() -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()

    val borderColor = when {
        isError -> scheme.error
        focused -> scheme.primary
        !enabled -> scheme.outline.copy(alpha = 0.5f)
        else -> scheme.outline
    }
    val textColor = if (enabled) scheme.onSurface else extended.mutedForeground

    // BasicTextField rejects a minLines other than 1 when singleLine is set, so
    // the two are reconciled here instead of at every call site.
    val effectiveSingleLine = singleLine && minLines <= 1
    val effectiveMinLines = if (effectiveSingleLine) 1 else minLines

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        if (label != null) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (isError) scheme.error else scheme.onBackground,
            )
        }

        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = textColor),
            keyboardOptions = keyboardOptions,
            singleLine = effectiveSingleLine,
            maxLines = if (effectiveSingleLine) 1 else Int.MAX_VALUE,
            minLines = effectiveMinLines,
            interactionSource = interactionSource,
            cursorBrush = SolidColor(if (isError) scheme.error else scheme.primary),
        ) { innerTextField ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FieldMinHeight)
                    .border(1.dp, borderColor, FieldShape)
                    .background(Color.Transparent, FieldShape)
                    .padding(horizontal = BallastSpacing.md, vertical = BallastSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (leadingIcon != null) {
                    Icon(
                        imageVector = leadingIcon,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = extended.mutedForeground,
                    )
                    Spacer(modifier = Modifier.width(BallastSpacing.sm))
                }
                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(
                            text = placeholder,
                            style = MaterialTheme.typography.bodyMedium,
                            color = extended.mutedForeground,
                            maxLines = 1,
                        )
                    }
                    innerTextField()
                }
                if (trailingIcon != null) {
                    Spacer(modifier = Modifier.width(BallastSpacing.sm))
                    trailingIcon()
                }
            }
        }

        if (supportingText != null) {
            Text(
                text = supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = if (isError) scheme.error else extended.mutedForeground,
            )
        }
    }
}

/** The transactions toolbar search box: no label, a magnifier, and a clear affordance. */
@Composable
fun BallastSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search",
) {
    // A plain clickable icon rather than [BallastIconButton]: an IconButton claims
    // a 48dp touch target, which a 36dp field cannot host without clipping.
    val clearButton: (@Composable () -> Unit)? = if (value.isEmpty()) {
        null
    } else {
        {
            Icon(
                imageVector = Icons.Filled.Clear,
                contentDescription = "Clear search",
                modifier = Modifier
                    .size(20.dp)
                    .clip(Pill)
                    .clickable { onValueChange("") },
                tint = MaterialTheme.ballastColors.mutedForeground,
            )
        }
    }

    BallastTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        placeholder = placeholder,
        leadingIcon = Icons.Filled.Search,
        trailingIcon = clearButton,
    )
}

// --- Previews --------------------------------------------------------------

@Composable
private fun TextFieldGallery() {
    var search by remember { mutableStateOf("Groceries") }
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
        ) {
            BallastTextField(
                value = "Acme Ltd",
                onValueChange = {},
                label = "Merchant",
                placeholder = "Who was paid",
            )
            BallastTextField(
                value = "",
                onValueChange = {},
                label = "Reference",
                placeholder = "Optional",
                supportingText = "Shown on the bank statement.",
            )
            BallastTextField(
                value = "12.3.4",
                onValueChange = {},
                label = "Amount",
                supportingText = "Enter a valid amount.",
                isError = true,
            )
            BallastTextField(
                value = "Locked",
                onValueChange = {},
                label = "Workspace",
                enabled = false,
            )
            BallastTextField(
                value = "Split across two cost centres, needs review before month end.",
                onValueChange = {},
                label = "Note",
                singleLine = false,
                minLines = 3,
            )
            BallastSearchField(value = search, onValueChange = { search = it })
            BallastSearchField(value = "", onValueChange = {})
        }
    }
}

@Preview(name = "Text fields light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun TextFieldLightPreview() {
    BallastTheme(darkTheme = false) { TextFieldGallery() }
}

@Preview(name = "Text fields dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun TextFieldDarkPreview() {
    BallastTheme(darkTheme = true) { TextFieldGallery() }
}
