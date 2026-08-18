"""Start the proxy with the token loaded from S17Code's .env.

The token is read here and never written anywhere the frontend build can see.

    uv run --project ../../S17Code python run.py
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
values = dotenv_values(ROOT / "S17Code" / ".env")
for key in ("S17_CONTROL_TOKEN", "S17_PORT"):
    if values.get(key):
        os.environ.setdefault(key, str(values[key]))
os.environ.setdefault("S17_BASE_URL", f"http://127.0.0.1:{os.environ.get('S17_PORT', '8113')}")

if __name__ == "__main__":
    import uvicorn

    print(f"proxy -> {os.environ['S17_BASE_URL']}  token configured: {bool(os.environ.get('S17_CONTROL_TOKEN'))}")
    uvicorn.run("main:app", host="127.0.0.1", port=int(os.getenv("LUMEN_PORT", "8115")), reload=False)
