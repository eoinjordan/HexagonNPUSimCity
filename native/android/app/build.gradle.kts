plugins {
    id("com.android.application")
}

android {
    namespace = "com.hexagonsimcity.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.hexagonsimcity.app"
        minSdk = 28
        targetSdk = 35
        versionCode = providers.gradleProperty("versionCode").orNull?.toInt() ?: 1
        versionName = providers.gradleProperty("versionName").orNull ?: "0.1.0"
        ndk { abiFilters += "arm64-v8a" }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    packaging { jniLibs.useLegacyPackaging = true }
    sourceSets.getByName("main") {
        assets.srcDir(layout.buildDirectory.dir("generated/assets"))
        providers.gradleProperty("qnnLibs").orNull?.let { jniLibs.srcDir(it) }
    }
}

val copyWeb by tasks.registering(Sync::class) {
    from("../../../dist") { into("web") }
    from("../../models") { into("models") }
    into(layout.buildDirectory.dir("generated/assets"))
    doFirst {
        require(file("../../../dist/index.html").isFile) { "Run npm run native:prepare first" }
        require(file("../../models/matmul-qdq.onnx").isFile) { "Run npm run native:prepare first" }
    }
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    val qnnAar = providers.gradleProperty("qnnAar").orNull
    if (qnnAar == null) {
        implementation("com.microsoft.onnxruntime:onnxruntime-android:1.23.2")
    } else {
        require(file(qnnAar).isFile) { "qnnAar must point to an existing QNN-enabled ONNX Runtime AAR" }
        implementation(files(qnnAar))
    }
    testImplementation("junit:junit:4.13.2")
}