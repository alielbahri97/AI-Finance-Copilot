package com.ballastmoney.android.di

import com.ballastmoney.android.data.bank.DataStorePendingBankConnectionStore
import com.ballastmoney.android.data.bank.PendingBankConnectionStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Bindings for the GoCardless bank-connection flow.
 *
 * Only one is needed. `BankConnectionRepository` is a concrete class with an
 * `@Inject` constructor, so Dagger can build it without being told; the store is
 * the one piece behind an interface, because the resume-and-poll rules have to be
 * testable without a `Context`.
 *
 * Singleton on purpose. The pending record is process-wide state — the accounts
 * screen and the picker have to agree about whether an attempt is outstanding —
 * and a second instance over the same DataStore file would be the one thing
 * DataStore explicitly forbids.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class BankModule {

    @Binds
    @Singleton
    abstract fun bindPendingBankConnectionStore(
        impl: DataStorePendingBankConnectionStore,
    ): PendingBankConnectionStore
}
