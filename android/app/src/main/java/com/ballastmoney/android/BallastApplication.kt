package com.ballastmoney.android

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.ballastmoney.android.session.SessionLockController
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class BallastApplication : Application(), SingletonImageLoader.Factory {

    @Inject
    lateinit var sessionLockController: SessionLockController

    override fun onCreate() {
        super.onCreate()
        // Registered here, not in the activity: the lock has to notice the whole
        // process going to the background, and an activity observer would fire on
        // a rotation too.
        sessionLockController.attach()
    }

    /**
     * Coil shares OkHttp with Ktor's engine so there is one connection pool and
     * one place to configure timeouts.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory()) }
            .crossfade(true)
            .build()
}
