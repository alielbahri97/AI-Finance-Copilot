package com.ballastmoney.android.di

import javax.inject.Qualifier

/**
 * A scope that lives as long as the process, for work that must not be
 * cancelled when the screen that started it goes away — persisting the session
 * lock flag being the obvious one.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher
