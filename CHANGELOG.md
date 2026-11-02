# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Documentation in three languages.** `README.md`, `README.vi.md`, `README.zh.md`, and every page
  under `docs/en`, `docs/vi` and `docs/zh`, sharing one set of images. `PRIVACY` likewise.
- **A demo recording** at `docs/media/demo.mp4` with narration, and `docs/media/demo.gif` embedded in
  the README. Both are captured from the synthetic fixture and labelled as such on screen;
  `scripts/make-demo.mjs` records the walkthrough.
- **Behaviour analysis split into three lanes** (you typing, subagents, unattended runs) on the
  Insight page, with probing share, image-read share and reads-per-write measured per lane. An
  agent running in its own git worktree enters through `cli` exactly like a person, so the lane is
  decided by working directory as well as `entrypoint`; on the machine this was developed against,
  that moved the unattended share from 4.7% to 35.1% of 86,474 tool calls.
- **Ask Claude to explain your numbers**: sends only the figures already on screen to your local
  `claude` binary, in a language and depth you choose, and shows a cost estimate measured from your
  own past headless runs. Roughly 300x cheaper than regenerating `/insights`, which takes no
  arguments and could not have honoured those controls.
- Shell-command grouping by the work being done, with heredocs, quoted program bodies and wrapper
  commands (`env`, `sudo`, `xargs`) handled so the verb counted is the one that ran.
- Documentation set under `docs/`: getting started, CLI reference, credits and cost, behaviour, and
  architecture.

### Changed

- Code, comments, tests and CLI output are written in English. The dashboard keeps Vietnamese,
  Chinese and English. A missing value now renders `n/a` everywhere instead of an em dash.

- The privacy promise is now stated narrowly: tool-call inputs are read, and only derived values
  (tool name, shell verb, file extension, last three path segments, counts) are stored. See
  [PRIVACY.md](./PRIVACY.md).
- "Not driven by you" no longer adds plugin MCP calls to subagent calls; those overlap, and the sum
  double counted.
- `scripts/make-fixture.mjs` now generates tool calls with real content, so the insight page has
  something to render in CI.

### Added (initial release)

- `tally index`: incremental scan of `~/.claude/projects/**/*.jsonl` into SQLite via a
  per-file byte watermark. 3.76 GB in ~13 seconds on first run; later runs read only new bytes.
- `tally report`: terminal tables by hour, day, month or year, in any timezone.
- `tally serve`: local dashboard with three pages (Dashboard, Analytics, Insight),
  plus `--watch` (rescan as new sessions land) and `--redact` (anonymize project paths).
- `tally doctor`: checks the five data sources and says which are missing.
- Plan-credit estimation fitted against the live `five_hour_pct` your client reports, with the
  fit error shown next to the number.
- Five waste findings, each priced: 1-hour cache writes, cache misses, subagent-heavy sessions,
  oversized model for trivial turns, and 5-hour ceiling risk.
- Insight page built from Claude Code's own `/insights` output, labelled **measured** or
  **Claude inferred** with sample sizes. Refreshing it asks first and shows the measured cost.
- Vietnamese, Chinese and English.

### Notes on accuracy

- USD figures match the `total_cost_usd` Claude Code reports to 1e-9 on the data tested.
- Credit figures are an **estimate**: Anthropic does not publish the formula. The fitted
  hypothesis (`input + output + cache writes + 0.025 × cache reads`) landed within 3–9% of the
  live percentage across the windows tested. The number always carries its error.
- A model with no published credit rate shows `n/a`, never `0`.
