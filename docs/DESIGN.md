# junit-axi — Design Plan

An AXI (Agent eXperience Interface) for JUnit: a token-efficient CLI that lets an AI agent run
JUnit tests and read the results without drowning in build output.

**Status:** planning, pre-release. v1 targets **Gradle only** and **does run tests**.
Spec `axi/1.0-2026-07`.

---

## 1. Why

An agent asked to "fix the failing test" runs `./gradlew test` and burns thousands of tokens on
Gradle banners, ANSI, download progress, full stack traces, and passing-test chatter — then still
has to locate and parse `build/test-results/**/*.xml` to learn which assertion actually failed.

junit-axi collapses that into a compact TOON summary: counts, the failing tests, and a pruned
failure with an explicit `--full` escape hatch.

**The premise is measured continuously, not once.** Every fixture (§10) captures *both* the raw
Gradle output and our compressed output, with token counts for each. The delta between them is the
value proposition, asserted on every CI run rather than estimated once against some project we
happen to have lying around. If a change makes our output less valuable, the ratio moves and the
diff says so.

---

## 2. Scope

**In, for v1:**

- Gradle **7.4 or newer** (wrapper-first) as the only execution path
- Running tests: whole project, whole module, whole class, single method
- Reading results from JUnit's legacy XML reports
- Compressing failures into an agent-sized form

**Out, for now** — deliberately, not permanently: Maven, the standalone ConsoleLauncher, tag/
category filtering (see §11), coverage, flaky-test retry.

**Gradle tooling is junit-axi's own.** A separate `gradle-axi` may exist independently; junit-axi
does not depend on it and does not shell out to it. AXI output is an agent-facing display format,
not a wire protocol — parsing another AXI's TOON would make our correctness hostage to its
formatting. If a shared Gradle surface proves substantial later, extract a *library* both CLIs
consume. Libraries compose; CLIs don't.

---

## 3. The two hearts

Everything else in this document is supporting structure for these two.

### 3.1 Run provenance — the correctness heart

**The failure that would destroy trust in this tool is confidently reporting stale green.**

Gradle marks `test` UP-TO-DATE and leaves the previous run's XML untouched. If `compileTestJava`
fails, the build aborts and prior XML sits there looking healthy. A naive implementation reads it
and reports "all passing" for a build that never compiled. This is documented, common, and the
reason CI systems ship stale-report detection.

The guard, designed in from the first commit:

1. **Stamp a monotonic timestamp immediately before invoking Gradle.**
2. **Treat any report file older than that stamp as absent.** Never merge old and new.
3. **Distinguish four outcomes explicitly** — they are different states and must never collapse
   into one another:

   | Outcome | Meaning | Exit |
   | ------- | ------- | ---- |
   | `passed` | tests ran, all green | 0 |
   | `failed` | tests ran, some red | 0 (failures are data) |
   | `no-tests` | build succeeded, nothing matched | 0 |
   | `did-not-run` | compile error / config error / task never executed | 1 |

`did-not-run` must carry the compiler or configuration error, compressed. "0 tests" and "the build
is broken" look identical in the reports directory and mean opposite things to an agent.

4. **Report the run timestamp in every output** that reads cached reports, so a stale read is
   visible rather than silent.

### 3.2 Failure compression — the value heart

This is why the tool exists, and it's the part with no prior art to copy. Parsing XML is solved;
compressing failure output usefully is not.

- **Stack-trace pruning.** Default to project frames — infer the project's base packages from the
  test class names present in the reports, drop framework/JDK/reflection frames, keep the first
  foreign frame after the last project frame for context. `--full` restores everything.
- **Assertion-diff extraction.** AssertJ, Hamcrest, Truth, and Kotest emit multi-line
  expected/actual diffs where *the diff is the entire useful payload*. Preserve it intact and prune
  around it, rather than truncating blindly at a character count.
- **Truncation with an honest escape hatch.** Cap at ~800 chars, show the total size, and print the
  exact `--full` command — and only when content was actually cut.
- **Deduplicate.** Twenty tests failing from one cause share a trace; group them and show it once.

Target shape:

```
run[1]{outcome,tests,passed,failed,skipped,ms}:
  failed,142,139,3,0,8420
failures[3]{class,test,message}:
  OrderServiceTest,rejectsExpiredCard,"expected: <DECLINED> but was: <APPROVED>"
  OrderServiceTest,appliesTax,"expected: <10.80> but was: <10.00>"
  CartTest,mergesDuplicates,"NullPointerException: cart.items is null"
help[3]:
  junit-axi show OrderServiceTest#rejectsExpiredCard
  junit-axi run OrderServiceTest
  junit-axi failures --full
```

---

## 4. Execution: Gradle

### 4.1 Invocation

Prefer `./gradlew` (or `gradlew.bat`), falling back to a `gradle` on `PATH`. Always pass
`--console=plain` to suppress ANSI and progress art. Capture stdout/stderr for error compression
but **never** relay them raw to our stdout.

**Never propagate Gradle's exit code.** Gradle exits nonzero on test failure — that is our exit-0
case. Truth comes from the parsed XML plus the provenance stamp; Gradle's code is at most a hint
for separating "tests ran and failed" from "the build died first."

### 4.2 Task discovery via injected init script

Task identification is the part that looked like it needed research. It mostly doesn't — Gradle can
enumerate its own test tasks precisely.

Inject a script with `--init-script` that walks `allprojects` and iterates
`tasks.withType(org.gradle.api.tasks.testing.Test)`, emitting for each: the task path, and its
`reports.junitXml.outputLocation`.

One invocation yields:

- **every test task, by type rather than by name-guessing** — `test`, `integrationTest`, custom
  source sets, and Android's `testDebugUnitTest` all fall out for free, because they are all
  `Test`-typed
- **each task's actual configured XML report directory**, so report locations are read from the
  build rather than assumed
- **full multi-module coverage** in a single call

Two caveats:

- `outputLocation` tells us *where* reports go, not *whether this run wrote them*. It complements
  the §3.1 timestamp guard; it does not replace it.
- `reports.junitXml.outputLocation` (a `DirectoryProperty`) replaced the older `destination` (a
  `File`) in **Gradle 7.4**, which is why 7.4 is our declared floor (§2). The script targets the
  modern API only. Detect the Gradle version up front and fail with a clear, structured
  "unsupported Gradle version" error rather than letting the init script throw something
  inscrutable.

Cache the result keyed on build-file mtimes — enumeration costs a Gradle invocation, and the home
view must stay cheap.

### 4.3 Selection

Scoped runs map to Gradle's `--tests` filter:

```
junit-axi run                                    # default test task(s)
junit-axi run OrderServiceTest                   # --tests '*OrderServiceTest'
junit-axi run OrderServiceTest#rejectsExpiredCard
junit-axi run src/test/java/.../OrderServiceTest.java   # path → class
```

Note the syntax translation: `#` is Maven/Surefire's method separator and is accepted here only as
the conventional test-id notation. **Gradle's `--tests` uses a dot** —
`OrderServiceTest#foo` maps to `--tests '*OrderServiceTest.foo'`.

Gradle's `--tests` matcher has multi-year open bugs at fine granularity: it silently under-matches
`@Nested` classes, and the documented `[2]` parameterized-index syntax does not work. We ship
selection anyway — running the whole suite every time is not acceptable — and mitigate honestly:

**Post-hoc verification.** After a scoped run, compare what was requested against what the reports
say actually executed. When they diverge, say so:

```
run[1]{outcome,tests,passed,failed,skipped,ms}:
  passed,1,1,0,0,3100
warning[1]{kind,detail,suggestion}:
  under-matched,"requested 4 tests, 1 executed","junit-axi run OrderServiceTest --all"
```

That turns a silent trap into something an agent can act on. Nested and parameterized selection are
documented limitations, not blockers.

---

## 5. JUnit version: a lookup table, not an architecture

The original draft of this plan built a `profiles/` adapter layer per JUnit version. That was
overbuilt. Under Gradle, JUnit version is **almost entirely invisible** to junit-axi:

- The **run command is identical** — `./gradlew test` regardless of version.
- The **report format is identical**, and under Gradle it is uniform *by construction* rather than
  by coincidence: **Gradle's own `Test` task writes the XML** (`TestTaskReports.junitXml`) from its
  test-event listeners, whatever engine actually ran underneath. JUnit's own
  `LegacyXmlReportGeneratingListener` belongs to the ConsoleLauncher path and never enters the
  Gradle path at all. We are reading Gradle's output, not JUnit's.
- **Selection syntax is identical** — `--tests` is Gradle's, not JUnit's.

What actually differs is small enough to be a table:

| Concern | JUnit 4 | JUnit 5 | JUnit 6 |
| ------- | ------- | ------- | ------- |
| Coordinates | `junit:junit:4.x` | `org.junit.jupiter:junit-jupiter:5.x` | `…:junit-jupiter:6.x` |
| Platform version | n/a | `org.junit.platform:*:1.x` | `org.junit.platform:*:6.x` |
| Test API package | `org.junit` | `org.junit.jupiter.api` | `org.junit.jupiter.api` |
| Java floor | 5+ | 8/11+ | **17+** |
| Grouping | `@Category` | `@Tag` | `@Tag` |
| Nested / parameterized | no | yes | yes |
| Gradle DSL | `useJUnit()` | `useJUnitPlatform()` | `useJUnitPlatform()` |

**Consequence: JUnit 5 and 4 support is largely free, and detection is primarily informational in
v1.** We surface the detected version because it's useful context for an agent, and because Java-17
and `@Category` edge cases need it — not because the execution path forks on it. The honest
validation is fixtures (§12), not adapter code: stand up JUnit 5 and JUnit 4 Gradle projects and
confirm they already work. Where they don't, fix the specific gap.

### 5.1 Detection signals, in precedence order

1. **Explicit `--junit <4|5|6>`** — always wins.
2. **Dependency coordinates** from `build.gradle{,.kts}`, `gradle/libs.versions.toml`, or the BOM.
   The Platform version break is the clean 5-vs-6 discriminator: JUnit 6 aligned
   `org.junit.platform:*` to `6.x`, JUnit 5 left it at `1.x`.
3. **Imports in an explicitly supplied test file** — a tiebreaker only, and only for 4-vs-Jupiter.

**Imports cannot distinguish 5 from 6.** Both use `org.junit.jupiter.api.*`. Any design leaning on
imports for version detection will silently mis-detect.

### 5.2 "Current test file" is an argument, not an inference

The CLI cannot know which file you have open. The target is an explicit optional argument; when
supplied, its imports feed signal 3 and its module scopes the run. The agent relays the file it is
editing. That is the contract, and it is honest about what the tool can know.

### 5.3 Mixed projects

Detection returns a set with a primary — a Vintage-plus-Jupiter project genuinely runs both.
`junit-axi detect` exposes the evidence chain so a mis-detection is diagnosable in one call:

```
detected[1]{build,junit,java,confidence}:
  gradle,6.1.2,17,high
tasks[2]{path,reports}:
  :app:test,app/build/test-results/test
  :app:integrationTest,app/build/test-results/integrationTest
evidence[2]{signal,source,value}:
  bom,gradle/libs.versions.toml,org.junit:junit-bom:6.1.2
  platform,build.gradle.kts,junit-platform-engine:6.1.2
```

---

## 6. Command surface

| Command | Purpose |
| ------- | ------- |
| `junit-axi` | Home. Detected stack, last-run summary, current failures. Test tasks *only if cached*. |
| `junit-axi run [<target>]` | Run all / module / class / method. Compact result summary. |
| `junit-axi failures` | Failures from the last run, from cached reports, without re-running. |
| `junit-axi show <test-id>` | One test in detail: pruned trace, assertion diff, captured output. |
| `junit-axi tests [<pattern>]` | Known tests, from the last run's reports. |
| `junit-axi tasks` | Discovered Gradle test tasks and their report directories. |
| `junit-axi detect` | Detection result and evidence chain. |
| `junit-axi setup hooks` | Opt-in SessionStart hooks (AXI principle 7). |

Cross-cutting flags: `--task`, `--module`, `--junit`, `--all`, `--fields`, `--full`, `--limit`,
`--fail-on-test-failure`, `--timeout`, `--help`.

`failures` and `show` reading cached reports without re-running is a deliberate token win: the
common agent loop is run once, inspect repeatedly. Both must print the run timestamp (§3.1).

**Home must never invoke Gradle.** It may load on every session via the SessionStart hook, so it
reads only the filesystem: cached task enumeration (§4.2) and existing report XML. On a cold cache —
fresh checkout, or any build-file edit that invalidates the mtime key — home omits the task list and
prints a `junit-axi tasks` hint instead of blocking for seconds on a cold Gradle daemon.

---

## 7. AXI compliance decisions

Standard AXI rules apply — TOON on stdout, 3–4 default fields, `[N]` count headers, `help[]`
disclosure blocks, silent stderr on success, `--help` everywhere, no ANSI. Two decisions are
specific to a test runner:

**Exit codes.** `run` exits **0 when tests fail** — the run succeeded, the failures are data. An
agent must never have to distinguish "tests failed" from "tool broke" by guessing. Exit **1** is
reserved for `did-not-run` (§3.1): no Gradle, compile error, unparseable or missing reports. Exit
**2** is usage error. `--fail-on-test-failure` opts into nonzero-on-red for CI.

**Error compression.** Gradle's failure output is enormous — a missing wrapper, a JDK mismatch (real
for JUnit 6's Java 17 floor), an unresolvable dependency, or a compile error each produce screens of
text. These must be compressed into a structured error naming the cause and a suggested fix. Raw
Gradle output never reaches stdout; `--full` can surface it on request.

---

## 8. Module layout

Added onto the `axi-axi new` scaffold, which supplies `src/index.ts`,
`src/cli/{args,help,router,spec}.ts`, `src/output/*`, `src/skill/`, and placeholder
`src/commands/{home,items}.ts` (`items.ts` is replaced by the real commands).

```
src/
  gradle/
    locate.ts        # wrapper discovery, gradle fallback
    invoke.ts        # run a task, capture output, never leak raw stdout
    tasks.ts         # init-script injection + Test-task enumeration + cache
    errors.ts        # compress Gradle failure output into structured errors
    init/tests.init.gradle
  report/
    legacy-xml.ts    # the parser — one format, all versions
    provenance.ts    # timestamp stamping, staleness rejection, outcome classification
    model.ts         # normalized TestRun / TestCase / Failure
  compress/
    stack.ts         # project-frame pruning
    assertion.ts     # AssertJ / Hamcrest / Truth / Kotest diff extraction
    group.ts         # deduplicate shared causes
  detect/
    junit-version.ts # coordinate fingerprints, evidence chain
    target.ts        # class / path / method parsing → Gradle --tests
  commands/          # home, run, failures, show, tests, tasks, detect
```

Two invariants worth enforcing with a test:

- **Nothing outside `detect/` branches on JUnit version.** A `if (version === 6)` in `report/` or
  `commands/` means version-specific logic leaked into a version-agnostic layer.
- **Nothing outside `gradle/` knows Gradle exists.** This is what keeps a future Maven driver from
  being a rewrite — and it's a cheaper invariant to hold than the version one, because the whole
  Gradle surface is already fenced into one directory.

---

## 9. Roadmap

Milestones, not releases — there is no release pressure. Decomposed by **capability**, because the
version axis turned out not to carry weight.

**M0 — the fixture harness.** Built first, because nothing after it can be validated without it: a
pinned JUnit 6 Gradle fixture, the dual-snapshot capture (§10.1), and the shared normalizer (§10.2).
The first snapshot is taken with no compression at all — that raw baseline is the number every later
milestone is measured against.

**M1 — the vertical slice.** Single-module Gradle project, default `test` task, JUnit 6. Invoke,
parse legacy XML, provenance guard with all four outcomes, compressed failures. `run`, `failures`,
`show`. This is the whole premise, end to end, on the easy case.

**M2 — task discovery.** Init-script enumeration, multi-module aggregation, non-default tasks
(`integrationTest`, Android `testDebugUnitTest`). `tasks` command, `--task`/`--module`.

**M3 — selection.** `--tests` mapping for class/method/path targets, plus post-hoc under-match
verification.

**M4 — version breadth.** JUnit 5 and JUnit 4 fixtures. Expectation: most of it already works.
Detection, `detect` command, the §5 lookup table. Fix only the specific gaps fixtures expose.

**M5 — AXI surface.** `SKILL.md` generation, `setup hooks`, `axi-axi validate --strict` in CI,
home-view token budget tuning.

**Later, separately:** Maven, ConsoleLauncher fallback, tag/category filtering, coverage.

---

## 10. Testing: dual-snapshot fixtures

The fixture suite is not a testing afterthought — it is the project's primary instrument, and it is
built first (M0). It serves three jobs at once.

### 10.1 The dual snapshot

Every fixture is a real, runnable Gradle project with a **pinned exact JUnit version**. Each
captures two artifacts per scenario:

| Artifact | What it is | What it catches |
| -------- | ---------- | --------------- |
| `raw.txt` | normalized `./gradlew test` output | **upstream change** — JUnit or Gradle altered a trace shape, message, or report |
| `expected.toon` | our compressed output | **our regression** — compression got worse, or coped badly with the upstream change |
| `tokens.json` | token count of both *pre-scrub* (§10.2), plus the ratio | **value erosion** — the win shrinks silently |

The raw capture is the load-bearing idea and the part I would not have thought to include. It makes
the suite an **upstream change detector**: when JUnit 6.2 reformats an assertion message or Gradle
changes its XML, the `raw.txt` diff shows precisely what upstream did, and the `expected.toon` diff
shows whether our compression survived it. Without the raw capture we would only see our own output
break, with no signal as to why.

Pinning exact versions is what makes this work. A deliberate bump-and-review workflow (Renovate or
Dependabot against the fixture versions) turns "JUnit upgraded" from a surprise into a PR whose diff
is a readable account of what changed.

### 10.2 Normalization is the real engineering cost

Raw Gradle output is not deterministic — timings, absolute paths, daemon and version banners, JVM
identifiers, and unstable ordering will produce constantly-failing diffs, and a suite that cries wolf
gets ignored. **Both** artifacts pass through one shared scrubber before comparison: elapsed times
and durations to a placeholder, absolute paths to a project-relative form, daemon/welcome/deprecation
banners dropped, and test ordering sorted where Gradle does not guarantee it.

Our own output needs the same treatment — it carries `ms` durations.

**But the token counts must not be taken from the scrubbed artifacts.** Scrubbing is deeply
asymmetric: raw Gradle output is largely banners, absolute paths, and timings, so it loses a great
deal; our TOON has almost none of that and loses almost nothing. Counting post-scrub would shrink
the denominator far more than the numerator and *understate* the real win.

So the two purposes take different inputs:

| Purpose | Input | Why |
| ------- | ----- | --- |
| Diff stability (upstream detection) | fully scrubbed | non-determinism must not cause false diffs |
| Token counts in `tokens.json` | ANSI-stripped only, nothing else removed | this is what an agent actually pays for |

An agent pays for the banners and the absolute paths. The value metric has to count them.

**Token counting is `characters / 4`** — dependency-free, and adequate for the ratio and trend,
which is what the metric is for. Revisit only if the absolute numbers ever get quoted publicly,
where a real tokenizer would be worth its dependency.

**Counting pre-scrub makes the raw number environment-dependent, so CI cannot assert it.** M0
proved this the hard way: the same fixture measured 18,056 characters on a dev machine and 18,616
on a cold CI runner, because the runner genuinely pays for a distribution-download banner and has a
longer checkout path. Both numbers are correct. So `tokens.json` records two:

| Field | Scrub | Purpose |
| ----- | ----- | ------- |
| `raw` | ANSI-stripped only | the honest cost of the status quo on the capturing machine — informational, not asserted |
| `stable` | fully normalized | environment-independent, and therefore what CI asserts as the regression guard |

The **ratio** — the actual value proposition — is immune to this: both sides of a comparison come
from the same capture on the same machine, so whatever the environment adds appears in the
denominator of every comparison. `raw` still gets a loose order-of-magnitude bound in CI, so a
structural change the normalizer happens to scrub does not pass unnoticed.

### 10.3 The fixture catalog is deliberately adversarial

The value is in the hard cases, not "one passing test and one failing test":

- deep stack trace with heavy framework/reflection noise
- **`Caused by:` chains** — nested causes are among the largest token sinks in JVM output
- AssertJ, Hamcrest, Truth, and Kotest multi-line expected/actual diffs
- ~20 tests failing from a single shared cause (exercises dedup, §3.2)
- a test that writes substantial stdout/stderr
- parameterized tests with `[1]`-style display names, and `@Nested` classes
- **a fixture that fails to compile** and **a fixture with pre-seeded stale XML** — the regression
  guard on §3.1, and more important than any happy-path fixture. The stale fixture must
  *deliberately age* its seeded XML, and the harness must not touch those files during setup: if a
  copy or checkout refreshes their mtimes past the pre-run stamp, the guard test goes green without
  ever exercising the guard. The most important test in the suite is the easiest one to make pass
  vacuously.
- a scoped-run under-match case (§4.3), so the warning path stays covered

### 10.4 Matrix and cost

JUnit version is the primary axis: **6.x, 5.x, 4.x**, each pinned. Gradle version is a *secondary,
deliberately small* axis — a smoke subset pinning **both ends of the supported range**: 7.4 (the
declared floor, §2) and the current release. That catches an init script that silently depends on
something newer than the floor, and a newer Gradle that changes behaviour under us. The full
cross-product is not worth its runtime.

Fixtures invoke a real Gradle. That is slow and correct: mocking the build tool would test our
assumptions about Gradle rather than Gradle itself. Budget a warm daemon and keep the matrix small.

Alongside: **`axi-axi validate --strict`** in CI for the 16 automated compliance checks, plus
`npm run skill:check`. CI pins **Java 17+** (JUnit 6's floor) and runs the JUnit 4/5 fixtures on the
same JDK.

---

## 11. Open questions

1. **Tag filtering has no clean Gradle CLI path.** `@Tag`/`@Category` filtering is configured in the
   build script (`useJUnitPlatform { includeTags }`), not via a command-line flag. Options: inject
   it through the same init script used for task discovery, require the build to expose a property,
   or defer. *Leaning: defer past v1; revisit via init-script injection.*
2. **Multi-module default.** Aggregate all modules, or require `--module`? *Leaning: aggregate — the
   agent usually wants "what's red anywhere" — with `--module` to narrow.*
3. **Latency.** A cold Gradle daemon costs seconds and an agent is blocked the whole time. Do we
   stream anything, or just set a generous `--timeout` and stay silent? *Leaning: silent with a
   timeout; streaming conflicts with clean TOON output.*
4. **Scoped-run staleness.** `--tests` narrows the run, but Gradle may leave the *other* modules'
   reports in place. §3.1's timestamp guard handles it — confirm it holds for partial runs.
5. **Kotlin/Groovy/Scala test sources.** Detection is language-agnostic via coordinates, but the
   §5.2 import tiebreaker is Java-shaped. Confirm `.kt` before M4.
6. **Project-frame inference.** §3.2 infers base packages from test class names. Does that hold for
   projects whose test and main packages diverge? Fallback may be needed.

**Resolved:** Gradle 7.4 minimum (§2, §4.2). Token counting is `characters / 4` (§10.2). Tag
filtering deferred past v1. Multi-module aggregates by default. Slow runs stay silent behind a
timeout rather than streaming.

---

## References

- [JUnit 6.1.2 Overview](https://docs.junit.org/6.1.2/overview.html)
- [JUnit Platform Reporting](https://docs.junit.org/6.1.2/advanced-topics/junit-platform-reporting.html)
- [Console Launcher](https://docs.junit.org/6.1.2/running-tests/console-launcher.html)
- [Gradle: Testing in Java & JVM projects](https://docs.gradle.org/current/userguide/java_testing.html)
- [Gradle `TestTaskReports` API](https://docs.gradle.org/current/javadoc/org/gradle/api/tasks/testing/TestTaskReports.html)
- Gradle selection limitations: [#20523 `--tests` with nested classes](https://github.com/gradle/gradle/issues/20523),
  [#19897 parameterized selection](https://github.com/gradle/gradle/issues/19897)
- AXI spec `axi/1.0-2026-07` — `axi-axi principles list`, `axi-axi checklist`
