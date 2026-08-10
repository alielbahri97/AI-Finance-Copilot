package com.ballastmoney.android.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Wire shape for `GET /api/categories`.
 *
 * This route is not part of `MOBILE_API.md`. It predates the mobile contract and
 * is the web app's own, but it is the only way to learn the categories a
 * workspace *defines* rather than the ones its transactions happen to use, which
 * is what the filter sheet and the recategorise picker need — a brand-new
 * category with no transactions yet has to be selectable. Because it is outside
 * the frozen contract it is treated as best-effort: a failure here leaves
 * whatever categories Room already accumulated from transaction rows in place
 * and never fails the surrounding refresh.
 */
@Serializable
data class CategoriesResponseDto(
    val categories: List<CategoryDto> = emptyList(),
)

@Serializable
data class CategoryDto(
    val id: String,
    val name: String,
    /** `INCOME` or `EXPENSE`. */
    val type: String,
    val color: String? = null,
    val isDefault: Boolean = false,
    val transactionCount: Int = 0,
)
