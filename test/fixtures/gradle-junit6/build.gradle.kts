import org.gradle.api.tasks.testing.logging.TestExceptionFormat

plugins {
    java
}

repositories {
    mavenCentral()
}

// Pinned exactly. Bumping this is a deliberate act whose blast radius shows up
// as a diff in the captured snapshots — see docs/DESIGN.md §10.1.
dependencies {
    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    // AssertJ produces multi-line expected/actual diffs where the diff IS the
    // useful payload — the case §3.2's compression has to preserve rather than
    // truncate. Pinned for the same reason as the JUnit version.
    testImplementation("org.assertj:assertj-core:3.27.3")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

tasks.test {
    useJUnitPlatform()

    // Information parity (docs/DESIGN.md §10.2): the raw side of the snapshot must
    // carry the same failure detail junit-axi will deliver. Gradle's default console
    // output prints a terse "FAILED" and leaves traces in the XML/HTML — capturing
    // only that would compare our detailed output against a raw side missing the
    // same information, understating the ratio into meaninglessness.
    testLogging {
        events("passed", "failed", "skipped")
        exceptionFormat = TestExceptionFormat.FULL
        showStandardStreams = true
        showStackTraces = true
    }
}

// Deliberately NOT setting ignoreFailures. The fixture must behave like a real
// project — failing tests make Gradle exit nonzero — because that is exactly the
// condition junit-axi has to handle without propagating (docs/DESIGN.md §4.1).
// The harness swallows the exit code; the fixture does not hide it.
