package com.ballastmoney.android.session

import android.os.SystemClock
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionLockStore
import com.ballastmoney.android.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Locks the app after it has been away from the foreground for longer than the
 * user's threshold.
 *
 * Three details matter and each of them is a way the naive version breaks:
 *
 *  - the elapsed time comes from [SystemClock.elapsedRealtime], not
 *    `System.currentTimeMillis`, so putting the phone down and winding the clock
 *    back cannot buy free access.
 *  - the locked flag lives in DataStore, not in memory, so a lock survives the
 *    process being killed while the app sat in the background — which is the
 *    common case, not the rare one.
 *  - `elapsedRealtime` resets to zero on reboot. A stored value in the future
 *    relative to the current reading therefore means the device restarted, and
 *    that counts as "away long enough" rather than as a zero-length absence.
 *
 * It observes [ProcessLifecycleOwner] rather than an activity, so moving between
 * activities or rotating the screen is not mistaken for leaving the app.
 *
 * The lifecycle callbacks do nothing but read the clock and hand off to
 * [onEnteredBackground] and [onEnteredForeground], which take the time as an
 * argument. That split is what makes the timing rules testable on the JVM without
 * a device or a fake Android clock.
 */
@Singleton
class SessionLockController @Inject constructor(
    private val lockStore: SessionLockStore,
    private val preferences: PreferencesRepository,
    @ApplicationScope private val scope: CoroutineScope,
) : DefaultLifecycleObserver {

    val isLocked: Flow<Boolean> = lockStore.isLocked

    /** Called once from [com.ballastmoney.android.BallastApplication.onCreate]. */
    fun attach(owner: LifecycleOwner = ProcessLifecycleOwner.get()) {
        owner.lifecycle.addObserver(this)
    }

    override fun onStop(owner: LifecycleOwner) {
        val leftAt = SystemClock.elapsedRealtime()
        // Fire-and-forget on a process-scoped scope: onStop must not block, and
        // this write has to outlive whatever screen was on top. If the process is
        // killed before it lands, the previously stored locked flag still
        // applies, so the failure mode is a lock that stays as it was.
        scope.launch { onEnteredBackground(leftAt) }
    }

    override fun onStart(owner: LifecycleOwner) {
        val returnedAt = SystemClock.elapsedRealtime()
        scope.launch { onEnteredForeground(returnedAt) }
    }

    suspend fun onEnteredBackground(nowElapsedRealtimeMs: Long) {
        lockStore.recordBackgrounded(nowElapsedRealtimeMs)
    }

    suspend fun onEnteredForeground(nowElapsedRealtimeMs: Long) {
        // Nothing recorded means a cold start rather than a return, so whatever
        // the stored locked flag says is already correct.
        val leftAt = lockStore.backgroundedAt() ?: return
        val thresholdSeconds = preferences.preferences.first().sessionLockSeconds
        if (shouldLock(awayMs = nowElapsedRealtimeMs - leftAt, thresholdSeconds = thresholdSeconds)) {
            lockStore.setLocked(true)
        }
        lockStore.clearBackgrounded()
    }

    suspend fun unlock() {
        lockStore.clearBackgrounded()
        lockStore.setLocked(false)
    }

    /** Used by a "lock now" action, and before clearing session state on sign-out. */
    suspend fun lockNow() {
        lockStore.setLocked(true)
    }

    companion object {
        /**
         * A negative [awayMs] means `elapsedRealtime` went backwards, which only
         * happens across a reboot. Treated as a lock: the app was gone for at
         * least as long as a restart takes, and the alternative is a rule an
         * attacker can satisfy by turning the phone off and on again.
         */
        fun shouldLock(awayMs: Long, thresholdSeconds: Int): Boolean =
            awayMs < 0 || awayMs >= thresholdSeconds * 1_000L
    }
}
