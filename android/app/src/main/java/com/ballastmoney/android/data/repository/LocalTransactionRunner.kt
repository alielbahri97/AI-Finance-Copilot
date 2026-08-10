package com.ballastmoney.android.data.repository

import androidx.room.withTransaction
import com.ballastmoney.android.data.local.BallastDatabase

/**
 * Runs a block of local writes atomically.
 *
 * This exists as an interface for one reason: [TransactionsRemoteMediator] has
 * to write five tables in a single transaction, and a real [BallastDatabase] is
 * a generated Room class that needs either an instrumented device or
 * Robolectric to instantiate — neither of which this project's JVM unit tests
 * have. Depending on the narrow capability rather than the whole database lets
 * the mediator be tested against in-memory fakes while the production path
 * stays a genuine SQLite transaction.
 *
 * It is deliberately not a Hilt binding. [NetworkTransactionsRepository]
 * constructs [RoomTransactionRunner] itself from the injected database, which
 * keeps a one-line adapter out of the DI graph.
 */
interface LocalTransactionRunner {
    suspend fun <R> inTransaction(block: suspend () -> R): R
}

/**
 * The production implementation: a real Room transaction, so a page that fails
 * half way through leaves no partially-reordered list behind.
 */
class RoomTransactionRunner(private val database: BallastDatabase) : LocalTransactionRunner {
    override suspend fun <R> inTransaction(block: suspend () -> R): R =
        database.withTransaction(block)
}
