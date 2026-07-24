# junit-axi

An AXI (Agent eXperience Interface) for JUnit — a token-efficient CLI that lets an AI agent run JUnit tests through Gradle and read the results without drowning in build output.

Scaffolded by [axi-axi](https://github.com/CodyEngel/axi-axi) against AXI spec `axi/1.0-2026-07` (see [axi.md](https://axi.md)).

> **Status: pre-release, in progress.** The design is settled in [docs/DESIGN.md](docs/DESIGN.md); the command surface lands in M1. What exists today is the measurement harness (M0) described below.

## Fixtures and snapshots

The fixture suite is the project's primary instrument, not a testing afterthought — see [§10 of the design](docs/DESIGN.md#10-testing-dual-snapshot-fixtures). Each fixture is a real Gradle project with a pinned JUnit version, captured two ways:

| Artifact | Catches |
| --- | --- |
| `raw.txt` | **upstream change** — JUnit or Gradle altering a trace shape, message, or report |
| `tokens.json` | **value erosion** — the token win shrinking silently |

Snapshots live in `test/snapshots/<fixture>/`. Regenerate after an intentional change, then read the diff:

```sh
UPDATE_SNAPSHOTS=1 npx vitest run test/snapshot.test.ts
```

A change in `raw.txt` means something moved upstream. A change in `tokens.json` means the cost of the status quo moved.

## Develop

```sh
npm install
npm run build
node bin/junit-axi.js        # home view (live content, AXI principle 8)
npm test                    # AXI contract smoke tests
npm run skill:gen           # regenerate skills/junit-axi/SKILL.md (commit it)
```

Check compliance any time:

```sh
npx -y axi-axi validate "node bin/junit-axi.js" --dir .
npx -y axi-axi checklist --phase implement
```

## Agent integration

Two complementary paths (both optional):

- **Session hook** (ambient, live state): `npx -y axi-axi setup hooks --dir .` installs a SessionStart hook that loads the home view at session start.
- **Skill** (on-demand, broader support): `skills/junit-axi/SKILL.md` is generated from the same content as the home view; CI runs `npm run skill:check` so it cannot go stale.

## Structure

- `src/cli/`, `src/output/` — shared AXI plumbing (strict flag parsing, TOON output, structured errors), copied verbatim from axi-axi. To refresh after an axi-axi upgrade: `npx -y axi-axi new junit-axi --dir . --force` (review the diff first).
- `src/skill/content.ts` — single source for the home view and SKILL.md.
- `src/commands/` — your commands. `items.ts` is a worked example; replace it.
