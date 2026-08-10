package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill

/** The wash behind the initials, matching the accent-tinted avatars on the web. */
private const val AVATAR_TINT_ALPHA = 0.10f

/**
 * A member or workspace avatar.
 *
 * The initials are always drawn and the image is layered over them, so a slow or
 * failed load degrades to something readable rather than an empty circle.
 */
@Composable
fun BallastAvatar(
    initials: String,
    modifier: Modifier = Modifier,
    imageUrl: String? = null,
    size: Dp = 32.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(Pill)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = AVATAR_TINT_ALPHA), Pill),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initials.take(2).uppercase(),
            // Scaled off the circle so a 48dp avatar does not carry 11sp type.
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = (size.value * 0.36f).sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
        )
        if (imageUrl != null) {
            AsyncImage(
                model = imageUrl,
                contentDescription = null,
                modifier = Modifier
                    .size(size)
                    .clip(Pill),
                contentScale = ContentScale.Crop,
            )
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun AvatarGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Row(
            modifier = Modifier.padding(BallastSpacing.lg),
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BallastAvatar(initials = "AB")
            BallastAvatar(initials = "cd", size = 40.dp)
            BallastAvatar(initials = "Ballast", size = 48.dp)
            // No network in a preview, so this falls back to the initials —
            // which is exactly the state worth seeing.
            BallastAvatar(
                initials = "EF",
                imageUrl = "https://example.invalid/avatar.png",
                size = 40.dp,
            )
        }
    }
}

@Preview(name = "Avatar light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun AvatarLightPreview() {
    BallastTheme(darkTheme = false) { AvatarGallery() }
}

@Preview(name = "Avatar dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun AvatarDarkPreview() {
    BallastTheme(darkTheme = true) { AvatarGallery() }
}
