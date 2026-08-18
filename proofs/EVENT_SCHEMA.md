# The event stream, as recorded

Captured from a real run, not from documentation. Fixture:
`capture-094d190df93f.sse` (137 lines, 3,696 bytes). Build the frontend against
it offline.

    GET /v1/runs/{run_id}/events?reconnect=0&after=0

SSE. Each frame is `id: <seq>` + `data: <json>`, with `: keepalive` comments in
between — the browser's `EventSource` drops those, but a hand-rolled parser
must not choke on them.

## Vocabulary

Five types. `seq` is monotonic and is what `?after=N` resumes from.

| type | `source_kind` | carries |
|---|---|---|
| `RUN_STARTED` | `run_started` | nothing |
| `STATE_DELTA` | `graph_patched` | `delta.reason` — why the planner patched |
| `STEP_STARTED` | `task_started` | `stepName` |
| `STEP_FINISHED` | `task_succeeded` | `stepName`, `delta.value` = the capability's result |
| `RUN_FINISHED` | `derived` | nothing; terminal, then the stream closes |

`STEP_FINISHED.delta` is a JSON-patch-shaped `{op, path, value}` with
`path: /results/<stepName>`.

## What the panes read

**Run pane.** `STEP_STARTED` appends a node, `STEP_FINISHED` completes it.
`STATE_DELTA.delta.reason` is the planner's own sentence about why the graph
grew — worth rendering, it is the legibility the assignment is paying for.

**Source cards.** `web_search` results arrive in
`STEP_FINISHED.delta.value.hits[]`, each `{title, url, snippet}`, plus
`backend` (`ddgs`) and `errors[]`. That is the whole source card, already
shaped.

**Command nodes.** `run_command` results land in the same `delta.value`. Render
argv, exit code and captured output there.

## Ordering

`POST /v1/agent/runs` blocks for the entire run, so its response arrives after
`RUN_FINISHED`. Choose the `run_id` client-side, start the POST in the
background, and subscribe immediately. Measured on this machine, the run takes
**~4.5s to appear in the store**, so the first `GET .../events` returns `404`
and must be retried rather than surfaced. `capture_run.py` and the proxy both
retry for 15–20s.

Recorded timings for a trivial one-search question:

```
 4.6s  RUN_STARTED
 7.0s  STATE_DELTA + STEP_STARTED   call_web_search_1
11.5s  STEP_FINISHED
19.7s  STATE_DELTA + STEP_STARTED   (answer)
26.9s  STEP_FINISHED, STATE_DELTA, RUN_FINISHED
```

27 seconds with two nodes. The pane must show elapsed time per node from the
first frame or it will read as frozen.

## Reconnect

`?reconnect=1` leads with a single `STATE_SNAPSHOT` carrying the whole data
model, so a client rebuilds from one frame instead of refolding deltas. Not
present in this capture — first connects do not get one.

## Model note

`gemini-2.5-flash-lite` cannot drive this planner: it returns a patch with a
`decision` field, normalization declines it, repair fails, and the run finishes
with zero nodes and an empty answer. `gemini-2.5-flash` works. The failing run
is kept as `capture-345929e3f56d.sse`.
