import com.google.protobuf.gradle.id

plugins {
    application
    id("com.google.protobuf") version "0.9.4"
}

group = "com.cts"
version = "1.0.0"

repositories {
    mavenCentral()
}

val protobufVersion = "3.25.3"

dependencies {
    implementation("com.cts:t4-java-decoder:1.0.0")
    implementation("com.google.protobuf:protobuf-java:$protobufVersion")
    implementation("com.google.code.gson:gson:2.10.1")
    // Modern flat dark/light Swing Look-and-Feel. Single ~700 KB jar, no transitive deps.
    implementation("com.formdev:flatlaf:3.7.2")
}

application {
    mainClass.set("com.cts.javademo.Main")
}

// Only a JDK 19 is available; target 17 bytecode via --release (no toolchain provisioning).
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(17)
}

// ---------------------------------------------------------------------------
// Protobuf: the canonical .proto files live at the repo root. Some of them start
// with a UTF-8 BOM (auth/enums/market), which protoc rejects, so we stage a
// BOM-stripped copy and generate from that (same fix RustDemo's build.rs applies).
// ---------------------------------------------------------------------------
val repoProtoDir = rootDir.resolve("../../../proto").normalize()
val stagedProtoDir = layout.buildDirectory.dir("proto-clean")

val stageProtos by tasks.registering {
    description = "Copy repo protos into build/proto-clean, stripping UTF-8 BOMs."
    inputs.dir(repoProtoDir)
    outputs.dir(stagedProtoDir)
    doLast {
        val dst = stagedProtoDir.get().asFile
        dst.deleteRecursively()
        repoProtoDir.walkTopDown()
            .filter { it.isFile && it.extension == "proto" }
            .forEach { src ->
                val target = dst.resolve(src.relativeTo(repoProtoDir).path)
                target.parentFile.mkdirs()
                var bytes = src.readBytes()
                if (bytes.size >= 3 &&
                    bytes[0] == 0xEF.toByte() &&
                    bytes[1] == 0xBB.toByte() &&
                    bytes[2] == 0xBF.toByte()
                ) {
                    bytes = bytes.copyOfRange(3, bytes.size)
                }
                target.writeBytes(bytes)
            }
    }
}

sourceSets {
    main {
        proto {
            // Generate only from the staged (BOM-stripped) tree.
            setSrcDirs(listOf(stagedProtoDir.get().asFile))
        }
    }
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
}

tasks.named("generateProto") {
    dependsOn(stageProtos)
}

// The protobuf plugin bundles the source .proto files into the jar resources, so
// processResources consumes the staged (BOM-stripped) tree too.
tasks.named("processResources") {
    dependsOn(stageProtos)
}
