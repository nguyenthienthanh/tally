# Contributing

The package is marked `"private": true` on purpose. tally is not published to npm yet, and the flag
is there so a stray `npm publish` cannot change that by accident. Run it from a clone.

## Getting set up

```bash
pnpm install
pnpm build
pnpm test          # unit (vitest)
pnpm typecheck
pnpm exec playwright test   # end-to-end; needs an index, see below
```

End-to-end tests run against a real index. On a machine with no `~/.claude`, build a synthetic
one first: `node scripts/make-fixture.mjs`. That script **refuses to run** if `~/.claude.json`
already exists, so it can never overwrite a real setup.

## House rules

These are enforced by tests, not by review, because review forgets and tests do not.

**Not knowing is not zero.** If a rate, a ceiling or a conversion is unavailable, render `n/a` and
make the field nullable. A `0` where the truth is "unknown" tells the reader something false.

**Constants come from the caller.** `detectFindings` and `calibrate` take their credit table,
ceiling and hypothesis as parameters. Do not reach into a fallback table from inside them, because a
model that exists only in the live table will silently score zero and quietly disable a finding.
This mistake has been made five times in this codebase; the parameters exist to stop a sixth.

**An extrapolation says so.** A window much heavier than the one a fit was made on is labelled,
not presented as measured.

**No outbound network, ever.** A test scans every source file for outbound-capable calls, and an
end-to-end test fails if the page requests any host other than `127.0.0.1`. The one write
endpoint runs a local command and is guarded by a per-start token.

**No conversation content.** The parser drops `message.content` after counting tool uses, and the
database schema has no column that could hold message text. Both are covered by tests.

**Avoid `Math.max(...array)`.** It throws `RangeError` past roughly 10^5 arguments, and real
indexes are larger than that. Use a loop.

## Tests

A test that passes without touching the dangerous path is worse than no test, because it buys
false confidence. The worst bug found in this project so far, an index that permanently broke itself on a
half-written line, sat behind a green suite that only ever tested the planning
function, never a real file on disk. Write the test that writes the file.

When you fix a bug, the test comes first and must fail for the right reason before the fix lands.

## The demo recording

`docs/media/demo.gif` and `docs/media/demo.mp4` are rebuilt, not hand-edited:

1. Build the synthetic fixture into a throwaway HOME, index it and serve it
   (`scripts/make-fixture.mjs`, then `index` and `serve --port=7799`).
2. Record the walkthrough: `pnpm demo:record <port> <timings.json> <out-dir>`. Captions are injected
   into the page rather than burned in afterwards, so they move with the scroll, and each scene ends
   at an absolute mark so a voice track can be laid under it without drift.
3. Mux narration and encode with ffmpeg; cut a few seconds of it into the GIF.

Two rules hold for anything that leaves the repo as media: it is recorded from the fixture, never
from a real account, and the screen says so.
