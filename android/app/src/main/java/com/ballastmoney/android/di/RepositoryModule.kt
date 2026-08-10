package com.ballastmoney.android.di

import com.ballastmoney.android.BuildConfig
import com.ballastmoney.android.core.domain.DashboardRepository
import com.ballastmoney.android.core.domain.IntegrationsRepository
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionLockStore
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.TransactionsRepository
import com.ballastmoney.android.core.domain.WorkspaceSelection
import com.ballastmoney.android.data.fake.FakeDashboardRepository
import com.ballastmoney.android.data.fake.FakeIntegrationsRepository
import com.ballastmoney.android.data.fake.FakeSessionRepository
import com.ballastmoney.android.data.fake.FakeTransactionsRepository
import com.ballastmoney.android.data.preferences.DataStorePreferencesRepository
import com.ballastmoney.android.data.repository.NetworkDashboardRepository
import com.ballastmoney.android.data.repository.NetworkIntegrationsRepository
import com.ballastmoney.android.data.repository.NetworkSessionRepository
import com.ballastmoney.android.data.repository.NetworkTransactionsRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Provider
import javax.inject.Singleton

/**
 * The seam between the app and its data source.
 *
 * Everything above this line — ViewModels, screens, tests — depends only on the
 * interfaces in `core/domain`. That is what made replacing the fakes with the
 * Ktor-backed implementations a change to this file and nothing in `ui/`.
 *
 * ### Why a runtime choice rather than a compile-time binding
 *
 * Each of the four could have been a plain `@Binds` to the real implementation,
 * with the fakes deleted. They are kept, and chosen by
 * [BuildConfig.USE_FAKE_DATA] instead, because they still earn their place: the
 * seeded dataset is what the repository interface tests assert against, what the
 * three Compose UI tests assert against, and what makes every `@Preview` in the
 * app render something recognisable. Deleting them would cost real test coverage
 * to save one indirection.
 *
 * The flag is false in both build types, so the real network layer is what ships
 * and what a debug build talks to. Flipping it to true in `app/build.gradle.kts`
 * gives a working app with no backend at all.
 *
 * [Provider] rather than a direct injection on both sides, so only the one that
 * is actually chosen gets constructed. The fakes generate a sizeable dataset on
 * creation and the real ones want an HTTP client; building both to discard one
 * would be waste on every cold start.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    // Preferences are genuinely local, so DataStore is the real implementation
    // rather than a stand-in. One class serves three interfaces because the
    // session lock flag and the selected workspace have to be written to the
    // same file, atomically, as the rest of the settings.

    @Binds
    @Singleton
    abstract fun bindPreferencesRepository(impl: DataStorePreferencesRepository): PreferencesRepository

    @Binds
    @Singleton
    abstract fun bindSessionLockStore(impl: DataStorePreferencesRepository): SessionLockStore

    @Binds
    @Singleton
    abstract fun bindWorkspaceSelection(impl: DataStorePreferencesRepository): WorkspaceSelection

    companion object {

        @Provides
        @Singleton
        fun provideSessionRepository(
            real: Provider<NetworkSessionRepository>,
            fake: Provider<FakeSessionRepository>,
        ): SessionRepository = if (BuildConfig.USE_FAKE_DATA) fake.get() else real.get()

        @Provides
        @Singleton
        fun provideDashboardRepository(
            real: Provider<NetworkDashboardRepository>,
            fake: Provider<FakeDashboardRepository>,
        ): DashboardRepository = if (BuildConfig.USE_FAKE_DATA) fake.get() else real.get()

        @Provides
        @Singleton
        fun provideTransactionsRepository(
            real: Provider<NetworkTransactionsRepository>,
            fake: Provider<FakeTransactionsRepository>,
        ): TransactionsRepository = if (BuildConfig.USE_FAKE_DATA) fake.get() else real.get()

        @Provides
        @Singleton
        fun provideIntegrationsRepository(
            real: Provider<NetworkIntegrationsRepository>,
            fake: Provider<FakeIntegrationsRepository>,
        ): IntegrationsRepository = if (BuildConfig.USE_FAKE_DATA) fake.get() else real.get()
    }
}
