"""Fire one run with a chosen id and record its event stream to disk.

Proves the ordering the whole frontend depends on: the subscriber opens the
stream on an id it picked, while the blocking POST is still running.

    uv run --project ../../S17Code python capture_run.py "your question"
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
ENV = dotenv_values(ROOT / "S17Code" / ".env")
BASE = f"http://127.0.0.1:{ENV.get('S17_PORT', '8113')}"
AUTH = {"Authorization": f"Bearer {ENV['S17_CONTROL_TOKEN']}"}

question = sys.argv[1] if len(sys.argv) > 1 else "What is the capital of France? Answer in one line."
run_id = f"capture-{uuid.uuid4().hex[:12]}"
out = Path(__file__).parent / f"{run_id}.sse"

result: dict = {}


def fire() -> None:
    """The blocking POST. Its response arrives after the events are over."""
    with httpx.Client(timeout=httpx.Timeout(None)) as client:
        response = client.post(f"{BASE}/v1/agent/runs", headers=AUTH, json={
            "tenant_id": "lumen", "project_id": "research", "user_id": "capture",
            "prompt": question, "run_id": run_id,
        })
    result["status"] = response.status_code
    result["body"] = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text[:2000]


print(f"run_id   {run_id}\nquestion {question}\n")
worker = threading.Thread(target=fire, daemon=True)
started = time.time()
worker.start()

kinds: dict[str, int] = {}
lines = 0
with out.open("w", encoding="utf-8") as sink, httpx.Client(timeout=httpx.Timeout(None)) as client:
    # Subscribe to an id chosen before the run existed. Retry only while the
    # run is still reaching the store.
    while True:
        with client.stream("GET", f"{BASE}/v1/runs/{run_id}/events", headers=AUTH) as stream:
            if stream.status_code == 404:
                if time.time() - started > 20:
                    print("run never appeared")
                    break
                time.sleep(0.25)
                continue
            print(f"subscribed after {time.time() - started:.2f}s (status {stream.status_code})\n")
            for line in stream.iter_lines():
                sink.write(line + "\n")
                lines += 1
                if line.startswith("data: "):
                    try:
                        event = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    kind = str(event.get("type", "?"))
                    kinds[kind] = kinds.get(kind, 0) + 1
                    print(f"  {time.time() - started:6.1f}s  {kind}")
                    if kind == "RUN_FINISHED":
                        break
        break

worker.join(timeout=300)
print(f"\nwrote {out.name}  ({lines} lines, {out.stat().st_size} bytes)")
print("event types:", json.dumps(kinds, indent=2))
print("POST status:", result.get("status"))
body = result.get("body")
if isinstance(body, dict):
    print("POST run_id:", body.get("run_id"), "| matches:", body.get("run_id") == run_id)
    answer = str(body.get("answer", ""))
    print("answer:", answer[:400])
