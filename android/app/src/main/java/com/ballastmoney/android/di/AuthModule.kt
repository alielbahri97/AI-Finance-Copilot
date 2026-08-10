package com.ballastmoney.android.di

import com.ballastmoney.android.core.domain.AccessTokenProvider
import com.ballastmoney.android.core.domain.AuthStateSource
import com.ballastmoney.android.data.auth.SupabaseAuthGateway
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Binds the two auth interfaces to the one Supabase-backed implementation.
 *
 * Both point at the same [SupabaseAuthGateway] singleton on purpose. The token
 * the HTTP layer sends and the session the shell routes on have to be the same
 * session, or the app would render a signed-in interface while every request
 * came back `401`.
 *
 * Nothing else needs a binding: [com.ballastmoney.android.data.auth.AuthRepository],
 * [com.ballastmoney.android.data.auth.SupabaseClientProvider] and
 * [com.ballastmoney.android.data.auth.EncryptedSessionStorage] are
 * `@Singleton` classes with `@Inject` constructors, so Hilt builds them without
 * being told how.
 *
 * Separate from `CoreModule` and `RepositoryModule` because they are owned
 * elsewhere, and because a module per subsystem is the pattern the project
 * already follows.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {

    @Binds
    @Singleton
    abstract fun bindAccessTokenProvider(impl: SupabaseAuthGateway): AccessTokenProvider

    @Binds
    @Singleton
    abstract fun bindAuthStateSource(impl: SupabaseAuthGateway): AuthStateSource
}
