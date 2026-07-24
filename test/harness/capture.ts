/**
 * Dual-snapshot capture harness — docs/DESIGN.md §10.1.
 *
 * Runs a fixture's Gradle build and records two things per scenario:
 *
 *   raw.txt     normalized console output — catches UPSTREAM change (JUnit or
 *               Gradle altering a trace shape, a message, or the reports)
 *   tokens.json character/token counts — catches VALUE EROSION (the win shrinking)
 *
 * A third artifact, expected.toon (our compressed output), joins in M1. Until then
 * the compressed side is null and the baseline is the uncompressed cost of the
 * status quo — the number every later milestone gets measured against.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { countTokens, normalize, stripAnsi } from "./normalize.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
export const FIXTURES_DIR = join(REPO_ROOT, "test/fixtures");
export const SNAPSHOTS_DIR = join(REPO_ROOT, "test/snapshots");

/**
 * The capture command is part of the harness contract — docs/DESIGN.md §10.2.
 *
 * `clean` because a second `test` is UP-TO-DATE and prints nothing (§3.1's stale
 * problem biting the harness itself). `--no-daemon` and `--no-configuration-cache`
 * because both emit "Reusing…" banners that vary run to run. Changing this line
 * invalidates every snapshot, so change it deliberately.
 */
export const GRADLE_ARGS = [
  "clean",
  "test",
  "--console=plain",
  "--no-daemon",
  "--no-configuration-cache",
] as const;

export interface Capture {
  /** ANSI-stripped only. This is what tokens are counted from (§10.2). */
  ansiStripped: string;
  /** Fully scrubbed. This is what snapshots compare (§10.2). */
  normalized: string;
  /** Gradle's exit code. Recorded, never propagated (§4.1). */
  exitCode: number;
}

export interface TokenReport {
  fixture: string;
  method: "chars/4";
  note: string;
  /**
   * Pre-scrub (ANSI-stripped only) — the honest cost of the status quo on the
   * machine that captured it. ENVIRONMENT-DEPENDENT and deliberately not asserted:
   * a cold CI runner really does pay for the distribution banner, and its checkout
   * path is a different length from a dev machine's. Informational.
   */
  raw: { chars: number; tokens: number };
  /**
   * Post-scrub — environment-independent, and therefore the number CI asserts.
   * This is the regression guard: it moves only when real content changes.
   */
  stable: { chars: number; tokens: number };
  /**
   * M1 fills this in. Count it the SAME way as `raw` — ANSI-stripped only, never
   * normalized — or `ratio` compares a pre-scrub denominator against a post-scrub
   * numerator and quietly overstates the win.
   */
  compressed: { chars: number; tokens: number } | null;
  /**
   * compressed / raw, once M1 provides a compressed side. Lower is better.
   *
   * Note the ratio is immune to the environment dependence above: both sides come
   * from the same capture on the same machine, so whatever the runner adds to the
   * raw side is present in the denominator of every comparison.
   */
  ratio: number | null;
}

export function fixtureDir(fixture: string): string {
  return join(FIXTURES_DIR, fixture);
}

export function snapshotDir(fixture: string): string {
  return join(SNAPSHOTS_DIR, fixture);
}

/**
 * Run a fixture's Gradle build and capture its output.
 *
 * The fixture has failing tests on purpose, so Gradle exits nonzero. That is the
 * expected path, not an error: we record the code and let the caller decide from
 * the output. This is §4.1 ("never propagate the child exit code") applied to our
 * own tooling — a harness that threw here would fail on a working fixture.
 */
export async function captureFixture(fixture: string): Promise<Capture> {
  const cwd = fixtureDir(fixture);
  const wrapper = join(cwd, "gradlew");
  if (!existsSync(wrapper)) {
    throw new Error(
      `fixture "${fixture}" has no Gradle wrapper at ${wrapper} — ` +
        `generate one with: cd ${cwd} && gradle wrapper --gradle-version <version>`,
    );
  }

  // Start from a cold build directory every time. A warm one makes `:clean` report
  // plain `> Task :clean` while a fresh checkout reports `UP-TO-DATE`, which is a
  // real diff between a dev machine and CI. Removing it first makes the starting
  // state identical everywhere — and is the same instinct as §3.1: never let
  // leftover output from a previous run influence what we report.
  await rm(join(cwd, "build"), { recursive: true, force: true });

  const { combined, exitCode } = await run(wrapper, [...GRADLE_ARGS], cwd);

  return {
    ansiStripped: stripAnsi(combined),
    normalized: normalize(combined, { fixtureDir: cwd, repoRoot: REPO_ROOT }),
    exitCode,
  };
}

/**
 * Run a command with stdout and stderr merged at the file-descriptor level.
 *
 * Gradle splits its output: test events and task lines go to stdout, the failure
 * summary ("2 tests completed, 1 failed", "BUILD FAILED") goes to stderr. Capturing
 * the two pipes separately and concatenating them misorders the result — the final
 * stdout line lands before the whole stderr block, which is not what an agent sees.
 *
 * Pointing both descriptors at one file reproduces exactly what a terminal shows,
 * because the OS merges the writes in real arrival order. No shell involved.
 */
async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ combined: string; exitCode: number }> {
  const logPath = join(
    tmpdir(),
    `junit-axi-capture-${process.pid}-${cmd.replace(/\W+/g, "_")}.log`,
  );
  const handle = await open(logPath, "w+");

  try {
    const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
      const child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", handle.fd, handle.fd],
        env: {
          ...process.env,
          // Keep locale and terminal assumptions stable across machines.
          LANG: "en_US.UTF-8",
          TERM: "dumb",
        },
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => resolvePromise(code ?? -1));
    });

    const combined = await readFile(logPath, "utf8");
    return { combined, exitCode };
  } finally {
    await handle.close();
    await unlink(logPath).catch(() => {});
  }
}

export function buildTokenReport(fixture: string, capture: Capture): TokenReport {
  return {
    fixture,
    method: "chars/4",
    note:
      "`raw` is counted pre-scrub (ANSI-stripped only) because an agent pays for the " +
      "banners and absolute paths the normalizer removes — but that makes it vary by " +
      "machine, so CI asserts `stable` instead. The compressed/raw ratio is unaffected: " +
      "both sides come from one capture. See docs/DESIGN.md §10.2.",
    raw: {
      chars: capture.ansiStripped.length,
      tokens: countTokens(capture.ansiStripped),
    },
    stable: {
      chars: capture.normalized.length,
      tokens: countTokens(capture.normalized),
    },
    compressed: null,
    ratio: null,
  };
}

export async function writeSnapshot(
  fixture: string,
  capture: Capture,
): Promise<TokenReport> {
  const dir = snapshotDir(fixture);
  await mkdir(dir, { recursive: true });
  const report = buildTokenReport(fixture, capture);
  await writeFile(join(dir, "raw.txt"), capture.normalized, "utf8");
  await writeFile(join(dir, "tokens.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

export async function readSnapshot(
  fixture: string,
): Promise<{ raw: string; tokens: TokenReport } | null> {
  const dir = snapshotDir(fixture);
  try {
    const [raw, tokens] = await Promise.all([
      readFile(join(dir, "raw.txt"), "utf8"),
      readFile(join(dir, "tokens.json"), "utf8"),
    ]);
    return { raw, tokens: JSON.parse(tokens) as TokenReport };
  } catch {
    return null;
  }
}
