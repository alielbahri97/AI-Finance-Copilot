package com.ballastmoney.android.designsystem.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The web sets `--radius: 0.75rem` and derives the rest, which lands on
 * 8 / 10 / 12 / 16 px for `sm` / `md` / `lg` / `xl`.
 */
object BallastRadius {
    val sm: Dp = 8.dp
    val md: Dp = 10.dp
    val lg: Dp = 12.dp
    val xl: Dp = 16.dp
}

/** Fully rounded ends, for chips, dots, avatars and progress tracks. */
val Pill: RoundedCornerShape = RoundedCornerShape(percent = 50)

val BallastShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(BallastRadius.sm),
    medium = RoundedCornerShape(BallastRadius.md),
    large = RoundedCornerShape(BallastRadius.lg),
    extraLarge = RoundedCornerShape(BallastRadius.xl),
)
