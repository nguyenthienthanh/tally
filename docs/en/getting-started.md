# Getting started

## Requirements

- **Node 22.13 or newer.** tally uses the built-in `node:sqlite`, so there is no native module to
  compile and no database server to install. 22.5 ships that module behind `--experimental-sqlite`;
  22.13 is the first release where it simply works, so that is the floor. CI runs the suite on
  22.13, 24 and 26.
- **pnpm** (any recent version; CI uses 11). npm works too.
- A machine that has used Claude Code, so `~/.claude/projects` exists.

## Install

```bash
git clone https://github.com/nguyenthienthanh/tally.git
cd tally
pnpm install
pnpm build
```

There is no global install and no `npm publish` yet. Run it from the clone.

## 1. Check your data sources

```bash
node dist/cli.js doctor
```

`doctor` prints one line per source and marks each one present or missing:

| Source | What tally takes from it |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | per-request metadata and token counts |
| `~/.claude.json` | plan tier, and Claude Code's own credit constants |
| `~/.claude/cache/rate-limits.json` | current 5-hour and 7-day percentages |
| `~/.claude/cache/usage-cycle.json` | API-equivalent cost for the billing cycle |
| `~/.claude/usage-data/` | output of Claude Code's own `/insights` |

Missing sources are not fatal. The pages render what exists and mark the rest unknown. A missing
plan ceiling, for example, hides the credit side rather than inventing a number.

## 2. Build the index

```bash
node dist/cli.js index
```

The first run reads every transcript. Later runs read only the bytes appended since last time,
tracked per file as a byte watermark, so a daily run costs a fraction of a second.

Measured on the machine this was built on: 4.5 GB across 3,473 files in about 13 seconds, producing
a 55 MB SQLite file at `~/.tally/index.sqlite`.

`--full` forces a complete rescan. You need it rarely; the one case that matters is after upgrading
tally when the release notes say the derived-facts version changed, and even then the scanner
notices by itself and rescans once.

## 3. Open the dashboard

```bash
node dist/cli.js serve          # http://127.0.0.1:7777
node dist/cli.js serve --watch  # also rescan when new sessions land
```

The server binds to `127.0.0.1` only. Everything except two POST routes is read-only, and those two
routes require a token minted fresh at each server start and embedded in the page.

### Sharing a screenshot

```bash
node dist/cli.js serve --redact
```

`--redact` replaces project paths with salted hashes before they reach the page, so you can show the
numbers without showing what you work on.

## 4. Or stay in the terminal

```bash
node dist/cli.js report --grain=day --tz=Asia/Ho_Chi_Minh
```

Same numbers, no browser: plan and calibration status, credits and USD per model, a rollup by your
chosen grain, and the priced findings.

## A note on language

The dashboard is available in Vietnamese, Chinese and English, detected from the browser and
switchable by flag. The CLI prints in English. The documentation exists in all three languages;
see the links at the top of the README.

## Troubleshooting

**`No such built-in module: node:sqlite`.** You are on Node older than 22.13. Check with `node -v`.

**The dashboard says the index is stale.** The limit snapshot is newer than your last scan, so a
comparison would undercount. Run `node dist/cli.js index`.

**Credits show as `n/a` for a model.** That model has no published credit rate in your
`~/.claude.json`. tally renders unknown as `n/a` and never as `0`.

**Nothing at all is indexed.** Check that `~/.claude/projects` exists and contains `.jsonl` files.
`doctor` prints the file count and the total size it can see.
