package com.ballastmoney.android.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.BuildConfig
import com.ballastmoney.android.core.domain.AuthStateSource
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.ThemePreference
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.data.auth.AuthCallbackLink
import com.ballastmoney.android.data.auth.AuthRepository
import com.ballastmoney.android.session.SessionLockController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * What the app shell needs regardless of which screen is showing: whether
 * anyone is signed in, who they are, which workspace and edition they are in,
 * whether the app is locked, and which theme to use.
 *
 * The session is held here rather than fetched per screen because the bottom
 * bar and drawer are built from the permission set, and a screen-scoped copy
 * would let the chrome and the content disagree during a workspace switch.
 */
data class RootUiState(
    /**
     * Null until Supabase has finished reading the stored session.
     *
     * Three-valued on purpose. That read is a disk read and a decryption, so it
     * is fast but not instant, and collapsing "not known yet" into "signed out"
     * means every returning user is shown the sign-in screen for a frame or two
     * before being thrown into the app. Null renders a splash instead.
     */
    val isSignedIn: Boolean? = null,
    val isLoading: Boolean = true,
    val session: SessionBootstrap? = null,
    val errorMessage: String? = null,
    val theme: ThemePreference = ThemePreference.SYSTEM,
    val isLocked: Boolean = false,
    val sessionLockSeconds: Int = 45,
    val biometricUnlockEnabled: Boolean = true,
    /**
     * True while the app is reading the in-memory fixtures instead of the API.
     * Surfaced in the UI on purpose: a screen full of convincing but invented
     * balances should say so.
     */
    val usingSampleData: Boolean = BuildConfig.USE_FAKE_DATA,
)

@HiltViewModel
class RootViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val preferencesRepository: PreferencesRepository,
    private val sessionLockController: SessionLockController,
    private val authRepository: AuthRepository,
    authState: AuthStateSource,
) : ViewModel() {

    /**
     * `null` until the first emission, which is what [RootUiState.isSignedIn]
     * publishes as "not known yet".
     *
     * `onStart` rather than an `initialValue` on `stateIn`, because the
     * distinction only survives if the null is a real element of the stream —
     * `combine` will not produce anything at all until every input has emitted,
     * and the auth flow's first emission is the one being waited for.
     */
    private val signedIn = authState.isSignedIn
        .onStart<Boolean?> { emit(null) }
        .distinctUntilChanged()

    /**
     * The bootstrap fetch, as one value.
     *
     * Two separate flows would take [combine] to six inputs, and its widest
     * overload takes five.
     */
    private data class Bootstrap(val isLoading: Boolean = false, val error: String? = null)

    private val bootstrapState = MutableStateFlow(Bootstrap())

    /** The callback already acted on, so it is not acted on twice. */
    private var handledCallback: AuthCallbackLink? = null

    private val _recoveryLink = MutableStateFlow<AuthCallbackLink?>(null)

    /**
     * The reset link waiting to be spent, if the app was opened by one.
     *
     * Held here rather than read from the intent at the point of use, because a
     * link is good for exactly one password change and the launching intent is
     * not: it outlives the reset, so a user who signs out later in the same
     * session would be shown the new-password form again, wired to a link
     * Supabase has already invalidated. This is cleared the moment a session
     * appears, which is the moment the link stops being worth anything.
     *
     * Kept out of [RootUiState] on purpose — that is a snapshot the whole shell
     * reads, and this is a live credential only one screen has any business
     * with.
     */
    val recoveryLink: StateFlow<AuthCallbackLink?> = _recoveryLink.asStateFlow()

    val uiState: StateFlow<RootUiState> = combine(
        signedIn,
        sessionRepository.session,
        preferencesRepository.preferences,
        sessionLockController.isLocked,
        bootstrapState,
    ) { authed, session, preferences, locked, boot ->
        RootUiState(
            isSignedIn = authed,
            isLoading = boot.isLoading && session == null,
            session = session,
            errorMessage = boot.error.takeIf { session == null },
            theme = preferences.theme,
            // Locking is a gate on the interface, not a sign-out: the Supabase
            // session is untouched, so an unlock costs a fingerprint rather
            // than a password. It follows that there is nothing to lock when
            // nobody is signed in.
            isLocked = locked && authed == true,
            sessionLockSeconds = preferences.sessionLockSeconds,
            biometricUnlockEnabled = preferences.biometricUnlockEnabled,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = RootUiState(),
    )

    init {
        // The bootstrap payload is fetched with the access token attached, so
        // it can only be asked for once there is one. Re-run on every
        // transition into signed-in, which covers the cold start, a fresh
        // sign-in and a session restored after a reinstall alike.
        viewModelScope.launch {
            signedIn.collect { authed ->
                if (authed != true) return@collect
                // Spent, expired, or simply no longer relevant: whichever it
                // is, there is a session now and the link cannot produce a
                // better one.
                _recoveryLink.value = null
                bootstrap()
            }
        }
    }

    private suspend fun bootstrap() {
        bootstrapState.value = Bootstrap(isLoading = true)
        // Restore the workspace the user last chose before the first fetch,
        // so a Personal user does not see the Business dashboard flash by.
        val remembered = preferencesRepository.preferences.first().selectedWorkspaceId
        val result = if (remembered != null) {
            sessionRepository.selectWorkspace(remembered)
        } else {
            sessionRepository.refresh()
        }
        val failure = result.exceptionOrNull()
        val message = failure?.message?.takeIf { text -> text.isNotBlank() }
        bootstrapState.value = Bootstrap(
            isLoading = false,
            error = if (failure == null) null else message ?: BOOTSTRAP_FAILED,
        )
    }

    fun retry() {
        viewModelScope.launch { bootstrap() }
    }

    /**
     * Routes a `ballast://auth/...` callback to whichever half of the app can
     * use it.
     *
     * A confirmation link is redeemed immediately: its only purpose is to bring
     * the user back signed in. A recovery link is deliberately **not** —
     * redeeming it here would sign them in and the shell would drop them into
     * the app, which is exactly the screen they cannot use until they have
     * chosen a new password. It is parked in [recoveryLink] for the reset
     * screen, which spends it and sets the password in one operation.
     *
     * A recovery link with no credentials is parked too, rather than discarded:
     * it is an expired or already-used link, and it carries Supabase's own
     * explanation, which the reset screen can show instead of an empty form.
     *
     * Guarded on the link itself rather than on a boolean, so a second,
     * different link arriving in the same process is still acted on while a
     * recomposition handing back the same one is not.
     */
    fun onAuthCallback(link: AuthCallbackLink?) {
        if (link == null || link == handledCallback) return
        handledCallback = link
        if (link.isRecovery) {
            _recoveryLink.value = link
            return
        }
        if (link.hasCredentials) {
            viewModelScope.launch { authRepository.completeEmailConfirmation(link) }
        }
    }

    fun selectWorkspace(workspaceId: String) {
        viewModelScope.launch {
            preferencesRepository.setSelectedWorkspaceId(workspaceId)
            sessionRepository.selectWorkspace(workspaceId).onFailure { error ->
                bootstrapState.value = bootstrapState.value.copy(error = error.message)
            }
        }
    }

    fun setTheme(theme: ThemePreference) {
        viewModelScope.launch { preferencesRepository.setTheme(theme) }
    }

    fun unlock() {
        viewModelScope.launch { sessionLockController.unlock() }
    }

    fun lockNow() {
        viewModelScope.launch { sessionLockController.lockNow() }
    }

    /**
     * The real sign-out, and the only thing that ends the Supabase session.
     *
     * Order matters. Supabase goes first, because that is the step that can
     * fail and the one that makes the token useless; the rest is local
     * housekeeping that must happen regardless. The lock is cleared last so the
     * next person to open the app gets the sign-in screen rather than a lock
     * screen for an account that is no longer there.
     */
    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
            sessionRepository.signOut()
            preferencesRepository.setSelectedWorkspaceId(null)
            sessionLockController.unlock()
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L

        const val BOOTSTRAP_FAILED =
            "We could not load your account. Check your connection and try again."
    }
}
