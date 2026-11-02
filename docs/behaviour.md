# Behaviour: the three lanes

A raw count of tool calls answers nothing. "grep ran 11,849 times" is not a fact about you until
somebody says **who ran it**. On a machine that runs unattended pipelines, most of it was not you.

So before any ratio is shown, tally splits every tool call into three lanes.

| Lane | What it is | How it is detected |
| --- | --- | --- |
| **You typing** | Sessions you opened in a terminal | `entrypoint: cli`, not a sidechain, not an automation path |
| **Subagents** | Subagents inside those same sessions | `isSidechain: true` |
| **Unattended runs** | Headless jobs and agents in their own worktrees | `entrypoint: sdk-cli`, **or** a working directory under `.claude/worktrees/agent-…` or `~/.openclaw` |

## Why the working directory matters

Using `entrypoint` alone looks sufficient and is not. `claude -p` does report `sdk-cli`, but an
agent running in its own git worktree enters through `cli` exactly like a person typing.

On the machine this was built on, that distinction moved the unattended share **from 4.7% to 35.1%**
of 86,474 tool calls. A third of the behaviour on the page had been filed under "you".

## What each lane gets measured on

The same ruler for all three, because figures that cannot be compared teach nothing:

- **Share** of all tool calls, and the session count behind it.
- **Probing**: the percentage of shell commands that only look (`grep`, `head`, `tail`, `ls`, `cut`,
  `find`) rather than change anything. Measured over shell commands, not over all tool calls, which
  would quietly divide by the wrong thing.
- **Image reads**: the percentage of file reads whose extension is an image. An unattended render
  pipeline reads frames and sprites constantly; a person reading code does not.
- **Reads per write**: `null` when there are no writes at all, never `0`. "No writes" and "a ratio
  of zero" are different statements.
- **Where it runs**: the project folders the lane touches.

Measured example from that same machine:

| Lane | Calls | Share | Sessions | Probing | Image reads | Reads per write |
| --- | --- | --- | --- | --- | --- | --- |
| You typing | 34,286 | 39.6% | 8 | 52.8% | 64.4% | 3.3 |
| Subagents | 21,833 | 25.2% | 6 | 57.3% | 0.9% | 75.8 |
| Unattended runs | 30,355 | 35.1% | 872 | 58.7% | **79.0%** | 2.5 |

79% of the unattended lane's file reads are images. That is a render pipeline checking its own
output, which is the job doing its job. Reading it as a personal habit, and advising the person to
"read fewer files", would be advice aimed at nobody.

## What is deliberately not flagged

**Re-reading the same file inside one session** measured 1.8%. It is computed, it is shown, and it
is **not** raised as a problem, because it is not one. Flagging a non-problem trains people to
ignore the page.

## Shell commands, grouped by the work they do

Verbs are grouped as `probe`, `change`, `build`, `vcs`, `net` or `script`. A verb that fits no group
goes to **other**, never to a guessed group.

Extracting the verb is harder than taking the first word, and getting it wrong is silent:

- `cd ~/x && pnpm build` is a build, not a `cd`. Counting naively put `cd` above everything else and
  hid the real work.
- `python3 <<'TAG' … TAG` puts a whole program inside the command. Without stripping heredocs,
  `import` and `PYEOF` get counted as shell commands.
- `python3 -c "import json; print(1)"` does the same inside a quoted string.
- `env`, `sudo`, `time`, `xargs` delegate: the real verb is the next word.
- `do` and `then` are not wrappers to swallow. `do ls` is a call to `ls`.

Each of those was a wrong number on screen first, and each was fixed at the extractor rather than by
blacklisting the symptom.

## What leaves the parser

From a tool call, only derived values are kept: the tool name, the shell verb, the file extension,
the last three path segments, and a count. Never the command string, never file contents, never
message text. Tests assert that a serialized fact contains none of the original strings.
