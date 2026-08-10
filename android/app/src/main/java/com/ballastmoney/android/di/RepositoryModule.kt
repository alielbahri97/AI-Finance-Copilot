package com.ballastmoney.android.di

import com.ballastmoney.android.core.domain.DashboardRepository
import com.ballastmoney.android.core.domain.IntegrationsRepository
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionLockStore
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.TransactionsRepository
import com.ballastmoney.android.data.fake.FakeDashboardRepository
import com.ballastmoney.android.data.fake.FakeIntegrationsRepository
import com.ballastmoney.android.data.fake.FakeSessionRepository
import com.ballastmoney.android.data.fake.FakeTransactionsRepository
import com.ballastmoney.android.data.preferences.DataStorePreferencesRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * The seam between the app and its data source.
 *
 * Everything above this line — ViewModels, screens, tests — depends only on the
 * interfaces in `core/domain`. When the JSON API lands, each `Fake…` on the
 * right-hand side becomes the Ktor-backed implementation and nothing else in the
 * app changes. That is the whole reason the fakes were built behind interfaces
 * instead of being sprinkled through the ViewModels.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindSessionRepository(impl: FakeSessionRepository): SessionRepository

    @Binds
    @Singleton
    abstract fun bindDashboardRepository(impl: FakeDashboardRepository): DashboardRepository

    @Binds
    @Singleton
    abstract fun bindTransactionsRepository(impl: FakeTransactionsRepository): TransactionsRepository

    @Binds
    @Singleton
    abstract fun bindIntegrationsRepository(impl: FakeIntegrationsRepository): IntegrationsRepository

    // Preferences are genuinely local, so DataStore is the real implementation
    // rather than a stand-in. One class serves both interfaces because the
    // session lock flag has to be written to the same file, atomically, as the
    // rest of the settings.

    @Binds
    @Singleton
    abstract fun bindPreferencesRepository(impl: DataStorePreferencesRepository): PreferencesRepository

    @Binds
    @Singleton
    abstract fun bindSessionLockStore(impl: DataStorePreferencesRepository): SessionLockStore
}
