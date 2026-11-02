# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# React Native / Hermes
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.runtime.** { *; }

# Vision Camera
-keep class com.mrousavy.camera.** { *; }
-dontwarn com.mrousavy.camera.**

# Thermal printer / Bluetooth
-keep class com.pinmi.react.printer.** { *; }
-dontwarn com.pinmi.react.printer.**

# Microlan sdk2 label printer
-keep class com.microlan.printersdk2.** { *; }
-dontwarn com.microlan.printersdk2.**
-keep class com.kdspoz.retail.label.** { *; }

# Keep native methods
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
    native <methods>;
}
