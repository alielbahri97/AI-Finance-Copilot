package com.ballastmoney.android.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.room.Room
import com.ballastmoney.android.BuildConfig
import com.ballastmoney.android.core.domain.AccessTokenProvider
import com.ballastmoney.android.core.domain.WorkspaceSelection
import com.ballastmoney.android.data.local.BallastDatabase
import com.ballastmoney.android.data.local.CategoryDao
import com.ballastmoney.android.data.local.ImportBatchDao
import com.ballastmoney.android.data.local.OutboxDao
import com.ballastmoney.android.data.local.TransactionDao
import com.ballastmoney.android.data.remote.BallastAuth
import com.ballastmoney.android.data.remote.BallastJson
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpRequestRetry
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import javax.inject.Provider
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object CoreModule {

    @Provides
    @Singleton
    @ApplicationScope
    fun provideApplicationScope(@IoDispatcher dispatcher: CoroutineDispatcher): CoroutineScope =
        // SupervisorJob so one failed background write cannot take the rest of
        // the app's process-scoped work down with it.
        CoroutineScope(SupervisorJob() + dispatcher)

    @Provides
    @IoDispatcher
    fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO

    @Provides
    @Singleton
    fun provideJson(): Json = BallastJson

    @Provides
    @Singleton
    fun providePreferencesDataStore(
        @ApplicationContext context: Context,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create(
        produceFile = { context.preferencesDataStoreFile(PREFERENCES_NAME) },
    )

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): BallastDatabase =
        Room.databaseBuilder(context, BallastDatabase::class.java, BallastDatabase.NAME)
            // The cache is rebuildable from the server, so throwing away a
            // schema change is cheaper and safer than shipping a migration for
            // data that is not the record of truth. This must change if the
            // outbox ever holds writes that have not reached the server.
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides
    fun provideTransactionDao(database: BallastDatabase): TransactionDao = database.transactionDao()

    @Provides
    fun provideCategoryDao(database: BallastDatabase): CategoryDao = database.categoryDao()

    @Provides
    fun provideImportBatchDao(database: BallastDatabase): ImportBatchDao = database.importBatchDao()

    @Provides
    fun provideOutboxDao(database: BallastDatabase): OutboxDao = database.outboxDao()

    /**
     * The one HTTP stack, so timeouts, retries and token refresh have one home.
     *
     * OkHttp is the engine because the Supabase Kotlin SDK needs a Ktor engine
     * too.
     *
     * ### Why the providers are lazy
     *
     * [BallastAuth] needs an [AccessTokenProvider], whose implementation is
     * backed by the Supabase client, which builds its own HTTP stack. Injecting
     * the instance directly would be a request to construct that graph while
     * this very object is still being constructed. Taking [Provider]s and
     * resolving them on the first request instead means the client can be built
     * before anything that authenticates against it exists, and removes any
     * chance of a cycle here as the auth layer grows.
     */
    @Provides
    @Singleton
    fun provideHttpClient(
        json: Json,
        tokens: Provider<AccessTokenProvider>,
        workspace: Provider<WorkspaceSelection>,
    ): HttpClient = HttpClient(OkHttp) {
        // Non-2xx becomes an exception, which `apiCall` turns into a typed
        // BallastApiError, so repositories return Result rather than each of
        // them inspecting status codes.
        expectSuccess = true

        install(ContentNegotiation) { json(json) }

        install(BallastAuth) {
            this.tokens = LazyAccessTokenProvider(tokens)
            this.workspace = LazyWorkspaceSelection(workspace)
        }

        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 30_000
            socketTimeoutMillis = 30_000
        }

        install(HttpRequestRetry) {
            // Only server errors and connection failures are retried. A 4xx is
            // the client's fault and retrying it just wastes the user's battery.
            retryOnServerErrors(maxRetries = 2)
            retryOnExceptionIf(maxRetries = 2) { _, cause ->
                cause is java.io.IOException
            }
            exponentialDelay()
        }

        if (BuildConfig.DEBUG) {
            install(Logging) {
                // HEADERS, not BODY: response bodies here are bank balances and
                // transaction descriptions, which should not sit in logcat.
                level = LogLevel.HEADERS
            }
        }

        defaultRequest {
            url(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
        }
    }

    private const val PREFERENCES_NAME = "ballast_preferences"
}

/**
 * Defers resolving the real [AccessTokenProvider] until the first request needs
 * a token, so building the HTTP client does not require the auth graph to exist
 * yet. See [CoreModule.provideHttpClient].
 */
private class LazyAccessTokenProvider(
    private val delegate: Provider<AccessTokenProvider>,
) : AccessTokenProvider {
    override suspend fun currentAccessToken(): String? = delegate.get().currentAccessToken()

    override suspend fun refreshAccessToken(): String? = delegate.get().refreshAccessToken()
}

/** The same deferral for the workspace header. */
private class LazyWorkspaceSelection(
    private val delegate: Provider<WorkspaceSelection>,
) : WorkspaceSelection {
    override val selectedWorkspaceId: Flow<String?>
        get() = delegate.get().selectedWorkspaceId

    override suspend fun currentWorkspaceId(): String? = delegate.get().currentWorkspaceId()

    override suspend fun select(workspaceId: String?) = delegate.get().select(workspaceId)
}
