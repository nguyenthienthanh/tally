# Architecture

```
~/.claude/projects/**/*.jsonl ─┐
~/.claude.json                 │
~/.claude/cache/*.json         ├─► ingest ──► SQLite ──► engine ──► server ──► web
~/.claude/usage-data/**        ┘   (parse)   (~/.tally)  (pure fns)  (loopback)  (vanilla JS)
```

No framework, no bundler, no runtime dependency. The only production dependency is Node itself.

## `src/ingest` — reading transcripts

| File | Job |
| --- | --- |
| `scan.ts` | Decide what to read: per-file byte watermarks, and which files changed. |
| `parse.ts` | Turn one JSONL line into one usage event plus derived tool facts. **This is where privacy is enforced.** |
| `toolfacts.ts` | Derive a privacy-safe fact from a tool call: kind, shell verb, extension, shortened path. |
| `db.ts` | Schema, inserts, and the readers the engine uses. |
| `index.ts` | Orchestration, incremental scan, file watching, derived-facts versioning. |

Two details worth knowing before changing anything here:

- **A final line without a newline is never consumed.** Claude Code may be mid-write. An earlier
  version subtracted a virtual newline and produced a watermark of `-1`, which SQLite happily
  stored and which then threw on every subsequent scan. The index was permanently broken until a
  `--full`. There is now a test that writes a real half-line to a real file.
- **`FACTS_VERSION`** guards the derived facts. Bumping it clears `tool_facts` and the file
  watermarks once, so a changed extractor cannot leave half-old facts behind. A table that predates
  a column is dropped and rebuilt at open, because `CREATE TABLE IF NOT EXISTS` is silent about a
  missing column until the first insert fails.

## `src/engine` — pure functions

`credits`, `cost`, `summary`, `buckets`, `activity`, `sessions`, `findings`, `behaviour`. They take
their constants as parameters and return plain data. None of them opens a file or a socket, which is
why they are cheap to test.

One house rule lives here and has been broken five times: **constants come from the caller**. A
function that reaches into a fallback credit table internally will silently score a live-only model
as zero and quietly disable a whole finding.

## `src/server/serve.ts` — the local server

- Binds `127.0.0.1` only.
- Every route is `GET` and read-only, except `POST /api/insight/refresh` and
  `POST /api/explain/run`. Both need the `x-tally-token` header, both reject `GET` with `405`, both
  answer `409` while a run is in flight, and both spend your quota only after you agree in the page.
- The token is minted per server start and injected into the HTML. It is not persisted.
- `--redact` is applied at the boundary, so hashed paths are what the page receives, not what the
  page chooses to display.
- Caches (events, calibration, buckets, sessions, behaviour) are invalidated from one place keyed on
  the index state. A second cache keyed somewhere else is a second place to remember to clear, and
  that place gets forgotten.

## `src/insight` — the two model-powered paths

| Path | Cost | What it does |
| --- | --- | --- |
| `import.ts` / `readings.ts` | free | Read Claude Code's existing `/insights` output and turn it into labelled readings. |
| `run.ts` | expensive | Run `/insights` itself to regenerate that output. |
| `explain.ts` | cheap | Send the figures already on screen to `claude -p` and ask for an explanation. |

`/insights` takes no arguments. That is not a guess: the command definition in the Claude Code
binary shows `contentLength: 0`, and the prompt builder never reads its argument. So a language or
depth control attached to it would be a fake knob. `explain.ts` exists for that reason: a few KB of
already-measured numbers, where language and depth are genuinely in the prompt, at roughly 300× less
cost than regenerating `/insights`.

The cost shown before you agree is **measured**, not assumed: tally takes your own short `sdk-cli`
sessions from the index and reports their median. With fewer than 20 samples it reports "not
measured" instead of a tidy number.

## `web/` — the page

Vanilla ES modules, no build step. `app.js` renders, `src/i18n/{vi,zh,en}.js` are flat dictionaries,
`app.css` holds the tokens. The design follows a console theme: amber means a person, cool blue
means an instrument, monospace is reserved for measured values.

## Tests

- **Unit** (`test/`, vitest): parsing, watermarks, credits, cost, findings, sessions, behaviour,
  redaction, explain. Including a 3,000-line "big data" case so the planner is exercised against a
  real file rather than against its own plan.
- **End-to-end** (`e2e/`, Playwright): the real server against a real index, on desktop and phone
  viewports. One test asserts that the page never requests a host other than `127.0.0.1`.
- **CI** runs unit tests on Node 22.5, 24 and 26, then end-to-end against a synthetic fixture built
  by `scripts/make-fixture.mjs`, which refuses to run if `~/.claude.json` already exists so it can
  never overwrite a real setup.
