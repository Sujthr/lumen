"""Lumen's proxy: the only process that holds the control token.

Vite inlines every VITE_* variable into the bundle it ships, so a control token
reachable from the frontend is a published credential. It lives here instead,
and the browser talks only to this process. Same rule as the session's: the
thing being permitted cannot reach the thing that grants permission.

It also solves the ordering problem. POST /v1/agent/runs blocks for the whole
run, so the id in its response arrives after every event has been emitted, and
there is no listing route to discover it from. The proxy chooses the id up
front (S17Code accepts a client-supplied run_id), starts the run in the
background, and hands the browser the id immediately so it can open the stream
while the run is still going.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import uuid
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

S17_BASE_URL = os.getenv("S17_BASE_URL", "http://127.0.0.1:8113")
CONTROL_TOKEN = os.getenv("S17_CONTROL_TOKEN", "")
TENANT = os.getenv("LUMEN_TENANT", "lumen")
PROJECT = os.getenv("LUMEN_PROJECT", "research")
# The dev server's origin. The proxy is same-machine only; it is not a public API.
ALLOWED_ORIGINS = os.getenv("LUMEN_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

# How long the event stream will wait for a run that has been started but has
# not reached the store yet. The browser subscribes within milliseconds of the
# POST, so without this the first connect races the run into a 404.
RUN_APPEARS_WITHIN = float(os.getenv("LUMEN_RUN_APPEARS_WITHIN", "15"))

# Side-effecting capabilities are filtered out of the planner's manifest unless
# the request names them (planner.py:453), so an unset list does not merely
# refuse them at call time -- the model never sees them and improvises. Without
# this, a run asked to verify a claim by running code cannot, and answers with a
# plausible "Execution Output" section it never produced.
#
# This is the whole authority decision for the product, so it is written out
# rather than inherited: enough to write a snippet, run it, fix it and have it
# checked. Deliberately absent: send_channel_message and create_calendar_events
# (outward-facing), git_reset (destructive), launch_job, request_approval,
# index_file, copy_file, copy_code_file, remember_explicit_fact.
DEFAULT_SIDE_EFFECTS = "create_file,write_file,edit_code,run_command,validate_work"
ALLOWED_SIDE_EFFECTS = [
    name.strip() for name in os.getenv("LUMEN_SIDE_EFFECTS", DEFAULT_SIDE_EFFECTS).split(",") if name.strip()
]

app = FastAPI(title="Lumen proxy")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["*"])

# run_id -> what the background run did. Not a database on purpose: this is a
# single-machine dev surface, and the run's own journal is the durable record.
RUNS: dict[str, dict[str, Any]] = {}


def _auth() -> dict[str, str]:
    if not CONTROL_TOKEN:
        raise HTTPException(503, "S17_CONTROL_TOKEN is not set; the proxy refuses to serve without it")
    return {"Authorization": f"Bearer {CONTROL_TOKEN}"}


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=4_000)


def build_goal(question: str) -> str:
    """The one place the product injects intent. Logged verbatim per run.

    Kept deliberately thin: the how belongs in skills/cited-research/SKILL.md,
    which is markdown the agent requests, not a string baked into a proxy.
    """
    return question.strip()


async def _start_run(run_id: str, goal: str) -> None:
    RUNS[run_id] = {"status": "running", "goal": goal, "result": None, "error": None}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as client:
            response = await client.post(
                f"{S17_BASE_URL}/v1/agent/runs",
                headers=_auth(),
                json={"tenant_id": TENANT, "project_id": PROJECT, "user_id": "lumen-web",
                      "prompt": goal, "run_id": run_id,
                      "allowed_side_effects": ALLOWED_SIDE_EFFECTS},
            )
        if response.status_code >= 400:
            RUNS[run_id].update(status="failed", error=f"{response.status_code}: {response.text[:500]}")
            return
        RUNS[run_id].update(status="finished", result=response.json())
    except Exception as error:  # the browser must be told, not left streaming
        RUNS[run_id].update(status="failed", error=f"{type(error).__name__}: {error}")


@app.post("/api/ask")
async def ask(body: Ask) -> dict[str, str]:
    """Return the run id immediately; the run itself continues in the background."""
    _auth()
    run_id = f"lumen-{uuid.uuid4().hex[:16]}"
    goal = build_goal(body.question)
    asyncio.create_task(_start_run(run_id, goal))
    return {"run_id": run_id, "goal": goal}


@app.get("/api/runs/{run_id}/events")
async def events(run_id: str, reconnect: int = 0, after: int = 0) -> StreamingResponse:
    """Pipe S17Code's SSE through unbuffered, waiting for a run still starting."""
    headers = _auth()

    async def relay():
        deadline = asyncio.get_running_loop().time() + RUN_APPEARS_WITHIN
        async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as client:
            while True:
                url = f"{S17_BASE_URL}/v1/runs/{run_id}/events?reconnect={reconnect}&after={after}"
                try:
                    async with client.stream("GET", url, headers=headers) as upstream:
                        if upstream.status_code == 404:
                            # Started but not yet in the store. Keep the browser's
                            # connection open rather than handing it an error it
                            # would have to distinguish from a real 404.
                            #
                            # Wait on the run's own state rather than a constant:
                            # the first run after a restart takes far longer to
                            # register than a warm one, and a fixed deadline turns
                            # that into a spurious error. The deadline only applies
                            # once the run is no longer running.
                            record = RUNS.get(run_id, {})
                            still_starting = record.get("status") == "running"
                            if still_starting or asyncio.get_running_loop().time() < deadline:
                                await asyncio.sleep(0.25)
                                continue
                            detail = record.get("error") or "run not found"
                            yield f'data: {{"type":"LUMEN_ERROR","detail":{json.dumps(detail)}}}\n\n'
                            return
                        async for chunk in upstream.aiter_raw():
                            yield chunk
                        return
                except httpx.HTTPError as error:
                    yield f'data: {{"type":"LUMEN_ERROR","detail":"{type(error).__name__}"}}\n\n'
                    return

    return StreamingResponse(relay(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # a batching proxy turns a live graph into one late reveal
    })


@app.get("/api/runs/{run_id}/snapshot")
async def snapshot(run_id: str) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{S17_BASE_URL}/v1/runs/{run_id}/snapshot", headers=_auth())
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text[:500])
    return response.json()


@app.get("/api/runs/{run_id}")
async def result(run_id: str) -> dict[str, Any]:
    """What the blocking POST eventually returned, or why it did not."""
    record = RUNS.get(run_id)
    if record is None:
        raise HTTPException(404, "unknown run")
    return record


@app.get("/api/health")
async def health() -> dict[str, Any]:
    reachable, detail = False, None
    with contextlib.suppress(Exception):
        async with httpx.AsyncClient(timeout=5) as client:
            reachable = (await client.get(f"{S17_BASE_URL}/healthz")).status_code == 200
    if not CONTROL_TOKEN:
        detail = "S17_CONTROL_TOKEN is not set"
    return {"s17_base_url": S17_BASE_URL, "s17_reachable": reachable,
            "token_configured": bool(CONTROL_TOKEN), "detail": detail,
            "allowed_side_effects": ALLOWED_SIDE_EFFECTS}
