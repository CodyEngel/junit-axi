import { describe, expect, it } from "vitest";

import { countTokens, normalize, stripAnsi } from "./harness/normalize.js";

const ESC = String.fromCharCode(0x1b);

describe("stripAnsi", () => {
  it("removes CSI colour sequences", () => {
    expect(stripAnsi(`${ESC}[31mFAILED${ESC}[0m`)).toBe("FAILED");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("CalculatorTest > appliesTax() FAILED")).toBe(
      "CalculatorTest > appliesTax() FAILED",
    );
  });
});

describe("normalize", () => {
  it("scrubs build durations", () => {
    expect(normalize("BUILD FAILED in 11s")).toBe("BUILD FAILED in <duration>\n");
    expect(normalize("BUILD SUCCESSFUL in 1m 3s")).toBe(
      "BUILD SUCCESSFUL in <duration>\n",
    );
    expect(normalize("BUILD SUCCESSFUL in 450ms")).toBe(
      "BUILD SUCCESSFUL in <duration>\n",
    );
  });

  it("scrubs actionable-task counts, which vary with cache state", () => {
    expect(normalize("3 actionable tasks: 2 executed, 1 up-to-date")).toBe(
      "<actionable-tasks>\n",
    );
  });

  it("collapses absolute paths, preferring the longest matching root", () => {
    const out = normalize("see file:///repo/test/fixtures/f/build/reports/index.html", {
      repoRoot: "/repo",
      fixtureDir: "/repo/test/fixtures/f",
    });
    expect(out).toBe("see file://<fixture>/build/reports/index.html\n");
  });

  it("drops the welcome banner and its variable-length highlights block", () => {
    const input = [
      "Welcome to Gradle 8.14.3!",
      "",
      "Here are the highlights of this release:",
      " - Java 24 support",
      " - Something else",
      "",
      "For more details see https://docs.gradle.org/8.14.3/release-notes.html",
      "> Task :test",
    ].join("\n");
    expect(normalize(input)).toBe("> Task :test\n");
  });

  it("drops distribution download progress", () => {
    const input = [
      "Downloading https://services.gradle.org/distributions/gradle-8.14.3-bin.zip",
      ".............10%.............20%.............100%",
      "> Task :test",
    ].join("\n");
    expect(normalize(input)).toBe("> Task :test\n");
  });

  it("drops daemon lifecycle chatter", () => {
    const input = [
      "To honour the JVM settings for this build a single-use Daemon process will be forked.",
      "Daemon will be stopped at the end of the build",
      "> Task :test",
    ].join("\n");
    expect(normalize(input)).toBe("> Task :test\n");
  });

  it("sorts test-event blocks, keeping each trace with its header", () => {
    const input = [
      "ZebraTest > runsLast() PASSED",
      "",
      "AlphaTest > failsFirst() FAILED",
      "    org.opentest4j.AssertionFailedError: boom",
      "        at app//AlphaTest.failsFirst(AlphaTest.java:9)",
      "",
      "MiddleTest > inTheMiddle() PASSED",
    ].join("\n");

    expect(normalize(input)).toBe(
      [
        "AlphaTest > failsFirst() FAILED",
        "    org.opentest4j.AssertionFailedError: boom",
        "        at app//AlphaTest.failsFirst(AlphaTest.java:9)",
        "",
        "MiddleTest > inTheMiddle() PASSED",
        "",
        "ZebraTest > runsLast() PASSED",
        "",
      ].join("\n"),
    );
  });

  it("is idempotent", () => {
    const input = [
      "> Task :test FAILED",
      "",
      "CalculatorTest > appliesTax() FAILED",
      "    expected: <10.8> but was: <9.9>",
      "",
      "BUILD FAILED in 11s",
      "3 actionable tasks: 2 executed, 1 up-to-date",
    ].join("\n");
    const once = normalize(input);
    expect(normalize(once)).toBe(once);
  });
});

describe("countTokens", () => {
  it("estimates at chars/4", () => {
    expect(countTokens("a".repeat(400))).toBe(100);
    expect(countTokens("")).toBe(0);
  });
});
