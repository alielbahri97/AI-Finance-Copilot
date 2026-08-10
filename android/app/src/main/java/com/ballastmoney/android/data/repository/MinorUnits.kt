package com.ballastmoney.android.data.repository

import com.ballastmoney.android.data.local.TransactionEntity
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * A money value as a whole number of cents, for storage in SQLite.
 *
 * SQLite has no decimal type. Storing an amount as a REAL would introduce a
 * binary rounding error into figures the user compares against their bank, so
 * amounts are held as integers of minor units and reconstructed with
 * `BigDecimal.valueOf(minor, 2)`, which is exact.
 *
 * [RoundingMode.HALF_UP] rather than `UNNECESSARY`: the contract promises exactly
 * two decimals, so the rounding should never engage. But a third decimal arriving
 * from a future server should show a cent out rather than crash the transactions
 * list, and `UNNECESSARY` would throw. The cached totals are also derived —
 * `net` is a subtraction — and a derived value is the kind that acquires a scale
 * nobody intended.
 */
internal fun BigDecimal.toMinorUnits(): Long =
    setScale(TransactionEntity.MINOR_UNIT_SCALE, RoundingMode.HALF_UP)
        .unscaledValue()
        .toLong()

/** The inverse: cents back to an exact two-decimal amount. */
internal fun Long.fromMinorUnits(): BigDecimal =
    BigDecimal.valueOf(this, TransactionEntity.MINOR_UNIT_SCALE)
