# CLI reference

Run as `node dist/cli.js <command>` from the clone, or as `tally <command>` if you have linked the
bin. Running it with no command prints the help text.

---

## `tally index`

Scans `~/.claude/projects/**/*.jsonl` into SQLite at `~/.tally/index.sqlite`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--full` | off | Rescan every file from byte zero instead of continuing from each watermark. |

How the incremental scan works, and why it is safe to run while Claude Code is writing:

- Each file carries a **byte watermark**. The next run reads from there to EOF.
- A **final line without a trailing newline is not consumed**. Claude Code may be mid-write; the
  next run reads that line whole.
- A malformed line is counted and skipped. One bad line never aborts a multi-gigabyte scan.
- Rows are inserted with `INSERT OR IGNORE` on `(request_id, uuid)`, so a resumed session that
  rewrites earlier records cannot create duplicates.

Output reports files seen, scanned and skipped, lines good, bad and degraded, and rows inserted.
"Degraded" means the record lacked the `cache_creation` split, so the 5-minute and 1-hour cache
writes could not be separated for that line.

---

## `tally report`

Prints the same numbers as the dashboard, in the terminal.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--grain=` | `day` | `hour`, `day`, `month` or `year`. |
| `--tz=` | your system zone | Any IANA zone, for example `Asia/Ho_Chi_Minh` or `UTC`. |

Sections printed, in order: your plan and ceiling, the live 5-hour and 7-day percentages, the
calibration verdict, credits and USD per model, a rollup at your chosen grain (last 12 buckets), and
the findings with the money attached.

---

## `tally serve`

Starts the local dashboard.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port=` | `7777` | Port on `127.0.0.1`. |
| `--tz=` | your system zone | Timezone for every bucketed figure. |
| `--watch` | off | Rescan when a transcript changes, debounced, then refresh the data. |
| `--redact` | off | Replace project paths with salted hashes before they reach the page. |

The server binds to loopback only. Every route is `GET` and read-only except two:

- `POST /api/insight/refresh` runs Claude Code's own `/insights`.
- `POST /api/explain/run` asks your local `claude` binary to explain the figures already on screen.

Both require the header `x-tally-token` with the token minted at server start and embedded in the
page, both are rejected on `GET`, and both answer `409` while a run is in flight. Both spend your own
quota, so the page asks before calling them and shows a cost estimate measured from your own past
headless runs.

---

## `tally doctor`

Checks the five data sources and prints one line each, plus warnings that matter:

- the plan tier, its mode, and the 5-hour ceiling in credits
- where the credit constants came from (`live` from your `~/.claude.json`, or the bundled fallback)
  and how many models they cover
- the live limits and how old the snapshot is
- the billing cycle cost and how far into the cycle you are
- the transcript file count and total size
- how many `/insights` session-meta files and facets exist, and a warning when the facets cover only
  part of the sessions, because every friction figure must then carry its sample size
- when the index was last scanned, with a warning when it is old enough to make calibration report
  `stale_index`

---

## Paths tally uses

| Path | Read or written |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | read |
| `~/.claude.json` | read |
| `~/.claude/cache/rate-limits.json` | read |
| `~/.claude/cache/usage-cycle.json` | read |
| `~/.claude/usage-data/**` | read, and written only by the `/insights` refresh you approve |
| `~/.tally/index.sqlite` | written: the index |
| `~/.tally/explain-<lang>.json` | written: the last explanation, per language |
