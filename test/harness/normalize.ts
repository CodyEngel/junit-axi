/**
 * Shared output normalizer — docs/DESIGN.md §10.2.
 *
 * Raw Gradle output is not deterministic: timings, absolute paths, daemon and
 * distribution banners, and unstable test ordering all vary run to run. Snapshot
 * diffs built on that would fail constantly, and a suite that cries wolf gets
 * ignored. Everything here exists to make the diff mean something.
 *
 * Both sides of the dual snapshot pass through this same function — junit-axi's
 * own output carries `ms` durations and needs the same treatment.
 *
 * IMPORTANT: token counts are NOT taken from normalized text. Scrubbing is deeply
 * asymmetric — raw Gradle output is largely banners and absolute paths and loses a
 * great deal here, while our TOON loses almost nothing — so counting post-scrub
 * would understate the real win. See countTokens() and §10.2.
 */

// CSI-style escape sequences. --console=plain suppresses most of these, but Gradle
// and the JVM still leak them in some environments. Built from char codes rather
// than literal escapes so no raw control bytes end up in this source file.
const ESC = String.fromCharCode(0x1b);
const CSI_8BIT = String.fromCharCode(0x9b);
const ANSI_PATTERN = new RegExp(
  "[" + ESC + CSI_8BIT + "][[\\]()#;?]*" +
    "(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><]",
  "g",
);

/** Lines dropped wholesale: pure environment noise that varies by machine and run. */
const DROP_LINE_PATTERNS: RegExp[] = [
  // Distribution download on a cold wrapper cache (CI always, dev never).
  /^Downloading https:\/\/services\.gradle\.org\/distributions\//,
  /^[.]*\d{1,3}%[.]*$/,
  /^(?:[.]+\d{1,3}%)+[.]*$/,
  // Daemon lifecycle chatter.
  /^To honour the JVM settings for this build/,
  /^Daemon will be stopped at the end of the build/,
  /^Starting a Gradle Daemon/,
  /^The message received from the daemon indicates/,
  // Advisory nags that come and go with Gradle versions and cache state.
  /^Consider enabling configuration cache/,
  /^Configuration cache entry (?:stored|reused|discarded)/,
  /^See https:\/\/docs\.gradle\.org\/[^/]+\/userguide\/configuration_cache/,
  /^Welcome to Gradle /,
  /^For more details see https:\/\/docs\.gradle\.org\//,
  /^> Run with --scan to get full insights/,
  /^You can use '--warning-mode all'/,
];

/**
 * The "Welcome to Gradle X!" banner prints a variable-length highlights block that
 * only appears after a fresh distribution download. Drop from the banner through
 * the release-notes URL that terminates it.
 */
function dropWelcomeBlock(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^Welcome to Gradle /.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex(
    (l, i) => i > start && /^For more details see https:\/\/docs\.gradle\.org\//.test(l),
  );
  if (end === -1) return lines;
  return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

const TEST_EVENT = /^\s*\S.*\s>\s.*\s(?:PASSED|FAILED|SKIPPED)\s*$/;

function isTestEvent(line: string | undefined): boolean {
  return line !== undefined && TEST_EVENT.test(line);
}

/**
 * Gradle emits test events as tests complete, and completion order is not
 * guaranteed — especially once the fixture grows past a couple of tests. Sort
 * each contiguous run of test-event blocks by its header so ordering churn does
 * not read as a real diff.
 *
 * A block is its header line plus any following indented or blank lines (the
 * stack trace, assertion diff, and captured stdout hang off the header).
 */
function sortTestEventBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTestEvent(lines[i])) {
      out.push(lines[i]!);
      i++;
      continue;
    }

    const blocks: { key: string; body: string[] }[] = [];
    while (isTestEvent(lines[i])) {
      const header = lines[i]!;
      const body = [header];
      i++;
      while (
        i < lines.length &&
        !isTestEvent(lines[i]) &&
        (lines[i]!.trim() === "" || /^\s/.test(lines[i]!))
      ) {
        body.push(lines[i]!);
        i++;
      }
      while (body.length > 1 && body[body.length - 1]!.trim() === "") body.pop();
      blocks.push({ key: header, body });
    }

    blocks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const b of blocks) out.push(...b.body, "");
  }

  return out;
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/**
 * Replace a path root only where it is genuinely a path root — that is, at a
 * segment boundary.
 *
 * Plain substring replacement is wrong: a root of `/repo` also matches inside
 * `/reports`, silently corrupting unrelated paths in the snapshot. The lookahead
 * requires the next character to end the segment.
 */
function replacePathRoot(text: string, root: string, placeholder: string): string {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`${escaped}(?=/|$|[\\s"'\`,;:)\\]}>])`, "g"),
    placeholder,
  );
}

export interface NormalizeOptions {
  /** Absolute paths under this directory collapse to <fixture>. */
  fixtureDir?: string;
  /** Absolute paths under this directory collapse to <repo>. */
  repoRoot?: string;
}

/**
 * Full scrub, for snapshot comparison only. Never feed the result to countTokens().
 */
export function normalize(input: string, opts: NormalizeOptions = {}): string {
  let text = stripAnsi(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Paths first, so file:// URLs are handled before anything else rewrites them.
  // Longest root first: a fixture dir nested under the repo root must win.
  const roots = [
    opts.fixtureDir ? ([opts.fixtureDir, "<fixture>"] as const) : undefined,
    opts.repoRoot ? ([opts.repoRoot, "<repo>"] as const) : undefined,
  ]
    .filter((r): r is readonly [string, string] => r !== undefined)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [root, placeholder] of roots) {
    text = replacePathRoot(text, root, placeholder);
  }
  // Home directory, for wrapper-cache and toolchain paths.
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) text = replacePathRoot(text, home, "<home>");

  let lines = text.split("\n");
  lines = dropWelcomeBlock(lines);
  lines = lines.filter((l) => !DROP_LINE_PATTERNS.some((p) => p.test(l)));
  lines = sortTestEventBlocks(lines);

  text = lines.join("\n");

  // Durations: "BUILD FAILED in 11s", "in 1m 3s", "in 450ms".
  text = text.replace(/\bin \d+m \d+s\b/g, "in <duration>");
  text = text.replace(/\bin \d+(?:\.\d+)?m?s\b/g, "in <duration>");
  // "3 actionable tasks: 2 executed, 1 up-to-date" — varies with cache state.
  text = text.replace(/^\d+ actionable tasks?:.*$/gm, "<actionable-tasks>");
  // Gradle's own PID / port chatter, when it leaks.
  text = text.replace(/\bDaemon pid=\d+/g, "Daemon pid=<pid>");

  // Trailing whitespace and blank-line runs, which vary with what was dropped above.
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text + "\n";
}

/**
 * Token estimate: characters / 4 (docs/DESIGN.md §10.2, resolved).
 *
 * Dependency-free and adequate for the ratio and trend, which is what the metric
 * is for. Feed this ANSI-stripped text ONLY — not normalized text — because an
 * agent genuinely pays for the banners and absolute paths the normalizer removes.
 */
export function countTokens(ansiStrippedText: string): number {
  return Math.ceil(ansiStrippedText.length / 4);
}
