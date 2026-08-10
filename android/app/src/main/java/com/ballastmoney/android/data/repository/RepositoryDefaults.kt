package com.ballastmoney.android.data.repository

/**
 * Values more than one repository in this package needs, kept together so
 * neither gets a second, slightly different definition.
 */

/**
 * The currency to assume when a payload names none at all.
 *
 * Every endpoint that carries money also carries a `currency`, and the mappers
 * already fall back through the workspace and the profile before reaching this,
 * so it is a guard against a truncated response rather than a real default. It
 * matches the mapper's own fallback deliberately: two disagreeing defaults would
 * mean the dashboard and the accounts screen labelling the same figure with
 * different symbols.
 */
internal const val FALLBACK_CURRENCY = "EUR"
