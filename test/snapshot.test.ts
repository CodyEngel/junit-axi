/**
 * Dual-snapshot fixture tests — docs/DESIGN.md §10.
 *
 * These invoke a real Gradle. That is slow and deliberate: mocking the build tool
 * would test our assumptions about Gradle rather than Gradle itself.
 *
 * Regenerate after an intentional change:
 *
 *   UPDATE_SNAPSHOTS=1 npx vitest run test/snapshot.test.ts
 *
 * Then read the diff. A change in `raw.txt` means JUnit or Gradle changed something
 * upstream; a change in `tokens.json` means the cost of the status quo moved.
 */

import { describe, expect, it } from "vitest";

import { captureFixture, buildTokenReport, readSnapshot, writeSnapshot } from "./harness/capture.js";

const FIXTURES = ["gradle-junit6"];

const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

// A cold CI runner downloads the Gradle distribution and the JUnit artifacts before
// anything runs. Generous by design; the harness is I/O-bound, not compute-bound.
const GRADLE_TIMEOUT_MS = 900_000;

describe.each(FIXTURES)("fixture %s", (fixture) => {
  it(
    "matches its committed snapshot",
    async () => {
      const capture = await captureFixture(fixture);

      // The fixture fails tests on purpose, so Gradle exits nonzero. Assert that
      // rather than tolerate it: an exit 0 here would mean the failing test stopped
      // failing and the baseline no longer measures what it claims to.
      expect(capture.exitCode, "fixture should fail its tests on purpose").not.toBe(0);

      // Guard against an empty or truncated capture silently becoming the baseline.
      expect(capture.normalized).toContain("BUILD FAILED");
      expect(capture.normalized).toMatch(/FAILED/);

      if (UPDATE) {
        const report = await writeSnapshot(fixture, capture);
        expect(report.raw.tokens).toBeGreaterThan(0);
        return;
      }

      const committed = await readSnapshot(fixture);
      expect(
        committed,
        `no snapshot for "${fixture}" — generate with UPDATE_SNAPSHOTS=1 npx vitest run`,
      ).not.toBeNull();

      expect(capture.normalized).toBe(committed!.raw);

      // Token counts move with real content changes, not with noise. Compare the
      // character count exactly: if raw.txt matched but chars did not, something
      // the normalizer scrubs has changed size, which is worth surfacing.
      const fresh = buildTokenReport(fixture, capture);
      expect(fresh.raw.chars).toBe(committed!.tokens.raw.chars);
      expect(fresh.raw.tokens).toBe(committed!.tokens.raw.tokens);
    },
    GRADLE_TIMEOUT_MS,
  );
});
