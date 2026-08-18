"""Run one question through the proxy and record everything it did.

    uv run --project ../../S17Code python record_run.py <label> "<question>"

Writes <label>.json: nodes, commands actually executed, planner reasons, the
answer, and wall-clock. Used for the skill A/B and the failure demos, so both
arms are recorded the same way rather than described afterwards.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

PROXY = os.environ.get("LUMEN_PROXY", "http://127.0.0.1:8115")

label = sys.argv[1]
question = sys.argv[2]
out = Path(__file__).parent / f"{label}.json"

record: dict = {"label": label, "question": question, "events": [],
                "nodes": [], "commands": [], "planner_reasons": []}

with httpx.Client(timeout=httpx.Timeout(None)) as client:
    started = time.time()
    started_response = client.post(f"{PROXY}/api/ask", json={"question": question})
    started_response.raise_for_status()
    run_id = started_response.json()["run_id"]
    record["run_id"] = run_id
    print(f"{label}: {run_id}")

    deadline = started + 900  # a dead run leaves the stream open; do not wait on it forever
    with client.stream("GET", f"{PROXY}/api/runs/{run_id}/events") as stream:
        for line in stream.iter_lines():
            if time.time() > deadline:
                record["events"].append({"at": round(time.time() - started, 1),
                                         "type": "RECORDER_TIMEOUT", "step": None})
                print("  recorder timed out waiting for events")
                break
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            at = round(time.time() - started, 1)
            kind = event.get("type")
            record["events"].append({"at": at, "type": kind, "step": event.get("stepName")})

            value = (event.get("delta") or {}).get("value") or {}
            reason = (event.get("delta") or {}).get("reason")
            if reason:
                record["planner_reasons"].append(reason)
            if kind == "STEP_FINISHED":
                record["nodes"].append(event.get("stepName"))
                if isinstance(value, dict) and "exit_code" in value:
                    record["commands"].append({k: value.get(k) for k in
                                               ("command", "exit_code", "stdout", "stderr")})
            print(f"  {at:6.1f}s  {kind:<14} {str(event.get('stepName') or reason or '')[:46]}")
            if kind in ("RUN_FINISHED", "LUMEN_ERROR"):
                break

    result = client.get(f"{PROXY}/api/runs/{run_id}").json()

record["seconds"] = round(time.time() - started, 1)
record["status"] = result.get("status")
record["answer"] = (result.get("result") or {}).get("answer")
record["failures"] = [r for r in record["planner_reasons"] if "failed" in r.lower()]
out.write_text(json.dumps(record, indent=2), encoding="utf-8")

print(f"\n{label}: {len(record['nodes'])} nodes, {len(record['commands'])} commands run, "
      f"{len(record['failures'])} planner failures, {record['seconds']}s")
for command in record["commands"]:
    print(f"  $ {command['command']} -> exit {command['exit_code']}")
print(f"wrote {out.name}")
