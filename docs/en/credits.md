# Credits and cost

Two different numbers live side by side in tally, and they do not have the same standing.

- **USD** is computed from a published price list. It is exact.
- **Plan credits** are computed from a formula that Anthropic does not publish. It is fitted against
  your own live percentage, and it always carries its error.

This page explains both, and the four ways the credit side refuses to pretend.

---

## USD: exact

Per-million-token prices come from the Claude Code `claude-api` skill, pinned in
`src/data/pricing.ts` with the date they were read. Cache multipliers:

| Component | Multiplier on the input price |
| --- | --- |
| 5-minute cache write | 1.25× |
| 1-hour cache write | 2× |
| Cache read | 0.1×, with per-model exceptions |

The resulting figure was checked against the `total_cost_usd` that
`claude -p --output-format json` reports, and matched to the ninth decimal place
(`$0.356643` against `$0.356643`).

A model missing from the table contributes `$0` **and says so** rather than being silently priced
with a neighbour's rate.

---

## Plan credits: fitted, and labelled

### Where the constants come from

Claude Code stores its own credit table in `~/.claude.json` under
`cachedGrowthBookFeatures.tengu_amber_tally`:

```
credits = tokens / 1e6 × creditsPerMillionTokens[model]
fiveHourCredits = { default_claude_max_5x: 50000, default_claude_max_20x: 200000 }
```

tally reads that table live. A bundled fallback exists for machines where the key is absent, and
`doctor` tells you which one is in use. **Models absent from the table stay absent**: they render
`n/a`, never `0`.

### What is fitted

The open question is *which tokens count*. tally tries five hypotheses and picks the one that best
reproduces the `five_hour_pct` your own client reports:

| Hypothesis | Tokens counted |
| --- | --- |
| `in_out` | input + output |
| `out_only` | output |
| `in_out_write` | input + output + cache writes |
| `in_out_write_read25` | input + output + cache writes + 0.025 × cache reads |
| `all` | everything, cache reads counted in full |

The default is `in_out_write_read25`. The 0.025 weight is not decoration: on the window it was
derived from, counting cache reads in full overshot by two orders of magnitude, and the weight that
reproduced the live percentage was 0.0269. 1/40 is the round number next to it, and it is applied
only where the fit says it belongs.

`all` is deliberately never the default. It inflates credits by hundreds of times.

### The four refusals

`calibrate()` returns a status, and the page prints it next to the number:

| Status | Meaning |
| --- | --- |
| `calibrated` | A hypothesis reproduced the live percentage within 15%. The error is shown. |
| `poor_fit` | The best hypothesis still misses by more than 15%. The figures are labelled rough. |
| `low_signal` | Under 5% of the ceiling has been used. Too little signal to fit against. |
| `stale_index` | The index is older than the limit snapshot by more than five minutes, so the comparison would systematically undercount. It tells you to reindex instead of showing a wrong number. |
| `no_ceiling` | The plan ceiling could not be read. No calibration is attempted. |
| `no_data` | No events in the calibration window. |

There is a fifth label that is not a status. A 5-hour window far heavier than the one the fit was
made on is marked **extrapolated**, because a fit made on a light window says little about a heavy
one.

### Measured accuracy

On the machine this was built on, the fitted hypothesis landed **within 3 to 9%** of the live
percentage across the windows tested. That is the honest range, not a guarantee for your account.

---

## The findings, and the three kinds of damage

Five findings are detected, each priced. The important detail is that they do not all mean the same
thing by their number, so each carries a `damage_kind` and the page uses a different verb for each:

| Kind | Verb used | Example |
| --- | --- | --- |
| `saving` | "could save" | 1-hour cache writes you could have made 5-minute writes |
| `spend` | "already spent" | what subagent-heavy sessions cost |
| `peak` | "measured peak" | the heaviest 5-hour window against the ceiling |

This distinction exists because an earlier version reported a measured peak with the word "damage"
and made it read as money lost. A number without the right verb is a lie with a true value.

The five findings:

1. **1-hour cache writes** cost 2× the 5-minute write and need three reads to break even.
2. **Cache misses**: the read you paid to rebuild.
3. **Subagent-heavy sessions** on an expensive model.
4. **Oversized model** answering short turns that called no tools.
5. **Ceiling risk**: how often a rolling 5-hour window went past 80% of your plan ceiling.
