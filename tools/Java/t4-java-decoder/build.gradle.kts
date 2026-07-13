plugins {
    `java-library`
}

group = "com.cts"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

// Only a JDK 19 is available on this box; target 17 bytecode via --release so the
// library stays broadly consumable without provisioning a separate toolchain.
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(17)
}

tasks.named<Test>("test") {
    useJUnit()
    testLogging {
        events("passed", "skipped", "failed")
    }
}
