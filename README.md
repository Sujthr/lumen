# Lumen

A Perplexity clone whose answers are checked by running code.

Ask a question. Get an answer with sources you can open. And where a claim can
be settled by running something, the agent writes the snippet, runs it in a
sandboxed workspace, and cites the exit code and output next to the pages.

The engine is [S17Code](https://github.com/theschoolofai/S17Code) on 8113 and
[glc_v5](https://github.com/theschoolofai/glc_v5) on 8111. Everything in this
directory is mine; neither upstream repo contains a line of it, so a bug-fix PR
can never pick up product code.

---

## The one screenshot that matters

```
┌───────────────────────────────────────┬──────────────────────────────┐
│ Is Python's sorted() stable?          │ RUN                    194s  │
│                                       │                              │
│ 1 page read · 1 command run           │ planner                      │
│ claims execution — verified           │  Waiting for the inline …    │
│                                       │                              │
│ Yes, Python's sorted() is guaranteed  │ ● load_cited_research   0.1s │
│ stable [1]. …                         │ ● research_stability    9.4s │
│                                       │ ✗ run_verification     …     │
│ When this code is executed, the       │ ● run_stability_test    2.1s │
│ output is:                            │   ┌──────────────────────┐   │
│   [('blue',1),('blue',2),             │   │ $ python stability…  │   │
│    ('red',1),('red',2)]               │   │              exit 0  │   │
│                                       │   │ [('blue', 1), …      │   │
│ ── SOURCES ───────────────────        │   └──────────────────────┘   │
│ [1] docs.python.org           ↗       │ ● answer               14s   │
│ [2] $ python stability_test.py        │                              │
│     ran locally · exit 0              │                              │
└───────────────────────────────────────┴──────────────────────────────┘
```

That `exit 0` is a real subprocess. The output quoted in the answer is the
output that subprocess printed.

Recorded, and on disk as [proofs/demo_green.json](proofs/demo_green.json):

```
3 nodes, 1 command run, 0 planner failures, 25.4s
  $ python is_stable.py  ->  exit 0
    stdout: "sorted() is stable.
"

answer: "The script was executed, and the run_command output is as follows:
         Exit Code: 0
         Stdout:
         ```
         sorted() is stable.
         ```"
```

The string in the answer is the string the subprocess printed. Nothing in that
chain is the model's recollection.

---

## Why this rather than a plain Perplexity clone

A question-in / answer-out UI shows one long node and no refusals, and exercises
almost none of what Session 17 is about. Attaching a verifier fixes that
honestly:

| Session 17 idea | Where it appears here |
|---|---|
| the free judge | `run_command` decides whether the claim holds |
| the run must be visible | every node, command, exit code and refusal streams live |
| show it failing too | the agent's first attempts fail; it converges |
| behaviour in markdown | `skills/cited-research/SKILL.md` — and [an A/B showing it declined](proofs/SKILL_AB.md) |
| the judge is out of reach | `sources/**` is protected: it may cite evidence, never edit it |

### The guard, moved one domain over

Protected paths in a research workspace are not `tests/**`. They are the
evidence:

```
S17_PROTECTED_PATHS=sources/**,tests/**,test/**,**/tests/**,**/test_*.py,…
```

`sources/` holds the fetched pages the answer rests on. The agent may read
them. It may never edit them.

> The agent may cite the evidence. It may not edit the evidence.

---

## Run it

Five terminals' worth of setup, but only four processes.

```bash
git clone https://github.com/theschoolofai/glc_v5.git
git clone https://github.com/theschoolofai/S17Code.git
cd glc_v5  && uv sync && git checkout integration
cd ../S17Code && uv sync && git checkout integration
```

`integration` in each repo merges the seven fixes below. On plain `main` the
verification lane does not work at all — see [Bugs found](#bugs-found).

**glc_v5/.env** — provider keys live here and nowhere else:

```text
GEMINI_API_KEY_1..5=…
GEMINI_MODEL=gemini-2.5-flash
LLM_ORDER=gemini
GLC_PORT=8111
```

**S17Code/.env**:

```text
GLC_BASE_URL=http://127.0.0.1:8111
S17_PORT=8113
S17_GATEWAY_PROVIDER=gemini
S17_CONTROL_TOKEN=<a long random value>
S17_WORKSPACE=/absolute/path/to/lumen-workspace
S17_SKILLS_DIR=/absolute/path/to/skills
S17_ALLOWED_COMMANDS=pytest,python,uv,ruff,git,node,npm
S17_PROTECTED_PATHS=sources/**,tests/**,test/**,**/tests/**,**/test_*.py,**/*_test.py,conftest.py,**/conftest.py,pytest.ini,tox.ini,setup.cfg,pyproject.toml,.github/**
S17_MAX_REPEAT_FAILURES=4
```

Do **not** copy `.env.example`'s `S17_PROTECTED_PATHS` — see bug D.

Then start everything with one command:

```powershell
.\lumen.ps1 start        # Windows
```
```bash
./lumen.sh start          # macOS / Linux / Git-Bash
```

```
  Starting Lumen
  ──────────────────────────────────────────────────────────────
  ●  Ollama            up      port 11434 · pid 23892 · embeddings only
  ●  glc_v5 gateway    up      port 8111 · pid 9676 · holds the provider keys
  ●  S17Code           up      port 8113 · pid 16852 · the agent runtime
  ●  Lumen proxy       up      port 8115 · pid 6128 · holds the control token
  ●  Vite dev server   up      port 5173 · pid 5080 · the browser UI
  ──────────────────────────────────────────────────────────────
  Open http://127.0.0.1:5173   ·  logs in ./.logs/   ·  stop with ./lumen.sh stop
```

| Command | What it does |
|---|---|
| `start` | brings all five up **in dependency order**, waiting for each to answer its health endpoint before starting the next |
| `stop` | stops them in reverse, so the browser-facing end goes down before what it depends on |
| `restart` | both |
| `status` | what is up, on which port, under which PID |
| `logs <service>` | last 40 lines of stdout and stderr — `ollama`, `glc`, `s17`, `proxy`, `web` |
| `doctor` | prerequisites, config, **and today's Gemini quota** |

It waits on health rather than sleeping: a service that never answers is a
failure to report, not a delay to absorb. Starting when things are already up is
safe — each service is skipped if it is already listening, and a port held by
something unhealthy is reported rather than fought over.

`doctor` is the one to run first. It catches the three things that actually
stop this working:

```
  ●  control token      ok       set (value not shown)
  ◐  protected paths    narrow   5 patterns — DEFAULT_PROTECTED has 12
  ◐  gemini-2.5-flash   exhausted  HTTP 429 — switch GEMINI_MODEL to another bucket
```

The quota check matters more than it looks: the free tier is 20 requests per day
**per model, per project**, and the five keys share one project, so rotating keys
buys nothing. Switching `GEMINI_MODEL` to an untouched bucket does.

Open <http://127.0.0.1:5173>.

If you would rather run them by hand:

```bash
ollama serve                                            # embeddings only
cd glc_v5   && uv run glc serve                         # 8111
cd S17Code  && uv run s17code serve                     # 8113
cd lumen/server && uv run --project ../../S17Code python run.py   # 8115
cd lumen/web && npm install && npm run dev              # 5173
```

---

## How it fits together

```
browser :5173 ──/api──▶ proxy :8115 ──▶ S17Code :8113 ──▶ glc_v5 :8111 ──▶ Gemini
                          ▲                  │
              holds S17_CONTROL_TOKEN        └── workspace/ (edit) + sources/ (read-only)
```

**The token is the point of the proxy.** Vite inlines every `VITE_*` variable
into the bundle it ships, so a control token reachable from the frontend is a
published credential. It lives in the proxy; the browser never sees it. Same
rule as the session's: the thing being permitted cannot reach the thing that
grants permission.

**The proxy also fixes an ordering problem.** `POST /v1/agent/runs` blocks for
the whole run, so the `run_id` in its response arrives after every event has
been emitted, and there is no listing route to discover it from. The proxy
chooses the id up front, starts the run in the background, and hands the browser
the id immediately so it can subscribe while the run is still going. That
required a patch to S17Code, shipped as one of the PRs.

### Authority

`run_command` and friends are `side_effect=True`, and S17Code filters
side-effecting capabilities **out of the planner's manifest** unless the request
names them. An unset list does not merely refuse them at call time — the model
never sees them and improvises. The proxy declares exactly:

```
create_file, write_file, edit_code, run_command, validate_work
```

and deliberately not `send_channel_message`, `create_calendar_events`,
`git_reset`, `launch_job`, `request_approval`, `index_file`, `copy_file`,
`copy_code_file`, `remember_explicit_fact`.

---

## Bugs found

Seven, each on its own branch off `main` with a test that fails before and
passes after. Full write-ups in [../BUGS.md](../BUGS.md).

| # | Repo | What |
|---|---|---|
| A | glc_v5 | `os.chmod` silently no-ops on Windows, so "owner-only" secrets kept `BUILTIN\Users` |
| B | S17Code | the embedder's fallback was unguarded → raw `URLError` out of every run |
| C | S17Code | no `tzdata` → `current_datetime` raises for every non-UTC zone |
| D+E | S17Code | `cp .env.example .env` unprotects 7 of 12 judge paths, and import-time `load_dotenv` blinds the test that would catch it |
| F | glc_v5 | Gemini thinking never actually disabled: version-string matching, and `"off"` implemented as "don't configure" |
| G | S17Code | `run_command` returned a dataclass, so **the judge could not report its verdict** |
| — | S17Code | a caller could not observe the run it started; taken ids silently collided |

**F and G are why this product could not verify anything.** G broke every
command at serialization *after* it had run; F starved the planner's output
budget with uncapped reasoning. Both were found by the product failing, not by
reading code.

---

## What the agent wrote and what I wrote

Stated plainly, because the assignment asks.

**Claude (Anthropic's Claude Code) wrote**, under my direction and review:
`server/main.py`, `server/run.py`, all of `web/src/`, `web/verify-ui.mjs`,
`web/render-check.mjs`, `proofs/capture_run.py`, `proofs/record_run.py`,
`skills/cited-research/SKILL.md`, and every one of the seven upstream fixes
including their tests. It also did the diagnosis: the 509s local-model
measurement, the thinking-token table, the protected-path count.

**I wrote**: the product concept and the decision to attach a verifier to a
Perplexity clone, the choice of React/Vite/Tailwind, the direction on which
bugs to pursue, and the review of every diff before it was committed.

No prompt used here contained its own answer. Where I told it what to do, the
instruction is in the transcript, not smuggled into a "finding".

---

## What it still gets wrong

Read this section before believing the one above.

**It will describe output it never produced.** Before bug G was fixed, a run
answered with a fluent "Execution Output" section quoting results from a script
that had never executed — because `run_command` failed at serialization every
time and the model improvised. That reads exactly like a verified answer.

The UI now says so: every answer carries `N commands run`, and an answer whose
prose claims execution while the run executed nothing is flagged
`claims execution — unsupported` with a banner. Verified by `web/verify-ui.mjs`,
which replays recorded event streams through the real component tree. It is a
heuristic over phrasing, not a proof.

**A skill is advice, not authority, and ours was never even read.** `SKILL.md`
says to verify by running code. In a controlled A/B — same question, same model,
`S17_SKILLS_DIR` the only variable — the arm *with* the skill produced **fewer**
nodes and a worse answer:

| Arm | skills | nodes | commands | outcome |
|---|---|---|---|---|
| A | off | 2 | 0 | searched, answered with two citations |
| B | on | 1 | 0 | answered directly: "no information available to answer" |
| B repeat | on | 1 | 0 | answered directly again |

The skill was discovered and offered — the planner read its one-line description
and declined to load it, twice, as "a well-established property requiring no
external tools". The sentence that would have changed that decision is in the
skill *body*, which is only read after `load_skill`. **The model has to want the
skill before it can read the argument for wanting it.** Full write-up, with the
planner's own words: [proofs/SKILL_AB.md](proofs/SKILL_AB.md).

**Source quality is uneven.** Left alone the agent will cite geeksforgeeks
before the CPython changelog. The skill tells it to prefer primary sources; it
does not always.

**The free tier is the real ceiling.** The metric is
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value **20** — note
*PerProject*, so the five keys share one pool and rotation buys nothing on the
daily cap. That is 20 requests per day per *model*, total, against 10–20 calls
per run. Three model buckets were exhausted producing the runs in this README. Local models are not an escape: `qwen3:8b` took **509
seconds** for a single planner call, which is 45–85 minutes per run.

**Model choice is not a detail.** `gemini-2.5-flash-lite` cannot drive the
planner at all (returns a patch with a `decision` field; repair fails; the run
ends with zero nodes). `gemini-2.5-pro` returns 404, withdrawn for new users.

---

## Reproducing the evidence

```bash
cd lumen/proofs
uv run --project ../../S17Code python record_run.py my_label "your question"
```

Writes `my_label.json`: every event with timestamps, the nodes, the commands
actually executed with exit codes and stdout, the planner's own reasons, and
the answer.

`EVENT_SCHEMA.md` documents the AG-UI event stream as recorded from a real run
rather than from documentation, including the fixture the frontend was built
against.

### The recorded evidence

| File | What it shows |
|---|---|
| `demo_green.json` | the verification lane working: 1 command, `exit 0`, answer quoting the real stdout |
| `demo_refusals.json` | three refusals in one run — a shell metacharacter, the allowlist, and read-before-edit |
| `demo_verify.json` | the agent writing test files and then answering from documentation without running them — 0 commands, and the UI says so |
| `ab_skill_off/on/on_2.json` | the skill A/B, including the arm where the skill made it worse |

`demo_refusals.json` is the one worth reading in full. In a single run the agent
tried a shell, tried a program off the allowlist, and tried to edit a file it had
not read:

```
verify_stability_code -> CommandError: ';' has no meaning here: commands run
                         without a shell. Run one program per call.
run_python_sort_check -> CommandError: 'python3' is not an allowed command.
                         Allowed: pytest, python, uv, ruff, git, node, npm.
write_verify_script   -> EditError: cannot edit verify_stability.py before
                         reading it. Read the file first: editing from memory
                         rewrites code you never saw.
```

Nobody staged those. Each is the runtime refusing something the model genuinely
tried.

```bash
cd lumen/web && npm run build && node verify-ui.mjs
```

Three cases through the real code path: a command that ran renders its exit
code; an answer claiming execution with no command is flagged; a plain answer is
not accused of anything.
