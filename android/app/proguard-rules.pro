# R8 runs in full mode (see gradle.properties). Full mode is more aggressive
# about assuming a class is never instantiated reflectively, so anything the
# runtime looks up by name needs an explicit keep rule.

# --- kotlinx.serialization -------------------------------------------------
# The compiler plugin generates a companion `serializer()` for every
# @Serializable class. R8 has built-in rules for this since AGP 8, but the
# generated serializers for classes referenced only through a KSerializer type
# parameter still need to survive.
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class ** {
    @kotlinx.serialization.SerialName <fields>;
}

# --- Type-safe Compose Navigation ------------------------------------------
# Navigation reflects over the @Serializable route classes to build and parse
# destination arguments, so the route types must keep their names and fields.
-keep @kotlinx.serialization.Serializable class com.ballastmoney.android.navigation.** { *; }

# --- Ktor / OkHttp ---------------------------------------------------------
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-keepclassmembers class io.ktor.** { volatile <fields>; }
-dontwarn okhttp3.**
-dontwarn okio.**

# --- Room ------------------------------------------------------------------
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-dontwarn androidx.room.paging.**

# --- Hilt / Dagger ---------------------------------------------------------
# The Hilt Gradle plugin contributes its own rules; these only silence warnings
# about the annotations Dagger's generated code references at compile time.
-dontwarn javax.annotation.**

# --- Keep line numbers in crash reports ------------------------------------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
