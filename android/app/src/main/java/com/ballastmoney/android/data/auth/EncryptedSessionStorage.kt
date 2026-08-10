package com.ballastmoney.android.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.exception.NoSessionFoundException
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Where the Supabase session lives between launches.
 *
 * supabase-kt's own default is `SettingsSessionManager`, which on Android is
 * plain `SharedPreferences`. That is world-readable to anyone with root or a
 * backup of the data directory, and what it holds is a **refresh token** — a
 * long-lived bearer credential for the whole account, not a short-lived access
 * token. So this replaces it with [EncryptedSharedPreferences]: keys under
 * AES256-SIV (deterministic, so lookups still work) and values under
 * AES256-GCM, with the master key held in the Android keystore.
 *
 * ### Why `MasterKeys` and not `MasterKey.Builder`
 *
 * `androidx.security:security-crypto` is pinned at **1.0.0**, and the
 * `MasterKey`/`MasterKey.Builder` pair was only added in 1.1.0-alpha01 —
 * `MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)` is the only master-key
 * API that exists at this version, along with the five-argument
 * `EncryptedSharedPreferences.create` that takes an alias. Both are marked
 * deprecated in the *documentation*, which describes 1.1.0; at 1.0.0 they are
 * simply the API. This file is the one place to change when the version moves.
 *
 * ### Why a read failure clears rather than crashes
 *
 * A well-known behaviour of this library is that `create` throws — usually
 * `GeneralSecurityException`, sometimes an `InvalidProtocolBufferException`
 * from Tink underneath — when the keystore entry no longer matches the file.
 * That happens for reasons the user did nothing wrong to cause: restoring a
 * backup onto a new device, a keystore reset after a lock-screen change, or an
 * OEM wiping keys on an update. The stored bytes are then undecryptable no
 * matter what, so there is nothing to recover. Throwing would mean the app
 * cannot start at all, which is a far worse outcome than one extra sign-in, so
 * the file is deleted and a fresh, empty store is opened. If even that fails
 * the session is kept in memory for the life of the process: the user can still
 * sign in and use the app, they simply sign in again next launch.
 *
 * The in-memory copy is also the fast path — [loadSession] is called on every
 * cold start and there is no reason to decrypt twice.
 */
@Singleton
class EncryptedSessionStorage @Inject constructor(
    @ApplicationContext private val context: Context,
) : SessionManager {

    /**
     * `encodeDefaults` matters more than it looks. `UserSession.expiresAt`
     * carries a default that is computed as *now plus `expiresIn`* at
     * construction time, so leaving it out of the JSON would silently renew the
     * expiry on every read and the client would keep presenting a dead token.
     */
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val mutex = Mutex()

    private var cached: UserSession? = null
    private var resolvedPreferences: SharedPreferences? = null
    private var preferencesResolved = false

    override suspend fun saveSession(session: UserSession) {
        mutex.withLock {
            cached = session
            val preferences = preferences()
            if (preferences != null) {
                runCatching {
                    val encoded = json.encodeToString(UserSession.serializer(), session)
                    preferences.edit().putString(SESSION_KEY, encoded).apply()
                }
            }
        }
    }

    override suspend fun loadSession(): UserSession =
        loadSessionOrNull() ?: throw NoSessionFoundException()

    override suspend fun loadSessionOrNull(): UserSession? = mutex.withLock { readSession() }

    private fun readSession(): UserSession? {
        cached?.let { return it }
        val preferences = preferences() ?: return null
        val stored = runCatching { preferences.getString(SESSION_KEY, null) }.getOrNull()
            ?: return null
        val decoded = runCatching { json.decodeFromString(UserSession.serializer(), stored) }
            .getOrNull()
        if (decoded == null) {
            // Written by an older shape of UserSession, or truncated. Same
            // reasoning as a keystore mismatch: unusable, so drop it.
            runCatching { preferences.edit().remove(SESSION_KEY).apply() }
            return null
        }
        cached = decoded
        return decoded
    }

    override suspend fun deleteSession() {
        mutex.withLock {
            cached = null
            val preferences = preferences()
            if (preferences != null) {
                runCatching { preferences.edit().remove(SESSION_KEY).apply() }
            }
        }
    }

    /**
     * Opened once per process. A null result means the encrypted store could
     * not be created even after clearing it, and callers fall back to memory.
     */
    private fun preferences(): SharedPreferences? {
        if (preferencesResolved) return resolvedPreferences
        preferencesResolved = true
        resolvedPreferences = openEncrypted() ?: run {
            // Deleting the file removes the ciphertext but not the keystore
            // entry; `getOrCreate` reuses the entry and re-encrypts from empty,
            // which is what makes the retry meaningful rather than a repeat.
            runCatching { context.deleteSharedPreferences(FILE_NAME) }
            openEncrypted()
        }
        return resolvedPreferences
    }

    private fun openEncrypted(): SharedPreferences? = runCatching {
        EncryptedSharedPreferences.create(
            FILE_NAME,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrNull()

    private companion object {
        const val FILE_NAME = "ballast_supabase_session"
        const val SESSION_KEY = "session"
    }
}
