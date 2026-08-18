#!/usr/bin/env bash
# Start, stop and inspect the four services Lumen needs.
#
# Lumen is not one process. It is a browser talking to a proxy that holds the
# control token, talking to S17Code, talking to glc_v5, plus Ollama for
# embeddings. They come up in that order and each is useless until the one below
# it answers, so this waits for health rather than sleeping and hoping.
#
#   ./lumen.sh start     ./lumen.sh status    ./lumen.sh doctor
#   ./lumen.sh stop      ./lumen.sh logs s17  ./lumen.sh restart
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(dirname "$ROOT")"
LOGDIR="$ROOT/.logs"
PIDDIR="$ROOT/.logs/pids"

# key|name|port|cwd|health|note|command
SERVICES=(
  "ollama|Ollama|11434|$WORKSPACE|http://127.0.0.1:11434/api/tags|embeddings only|ollama serve"
  "glc|glc_v5 gateway|8111|$WORKSPACE/glc_v5|http://127.0.0.1:8111/healthz|holds the provider keys|uv run glc serve"
  "s17|S17Code|8113|$WORKSPACE/S17Code|http://127.0.0.1:8113/healthz|the agent runtime|uv run s17code serve"
  "proxy|Lumen proxy|8115|$ROOT/server|http://127.0.0.1:8115/api/health|holds the control token|uv run --project ../../S17Code python run.py"
  "web|Vite dev server|5173|$ROOT/web|http://127.0.0.1:5173/|the browser UI|npm run dev"
)

if [ -t 1 ]; then
  OK=$'\033[32m'; BAD=$'\033[31m'; WARN=$'\033[33m'; DIM=$'\033[90m'; HI=$'\033[36m'; OFF=$'\033[0m'
else
  OK=; BAD=; WARN=; DIM=; HI=; OFF=
fi
RULE="──────────────────────────────────────────────────────────────"

rule()  { if [ $# -gt 0 ]; then printf '\n  %s%s%s\n  %s%s%s\n' "$HI" "$1" "$OFF" "$DIM" "$RULE" "$OFF";
          else printf '  %s%s%s\n' "$DIM" "$RULE" "$OFF"; fi; }
row()   { # name state colour detail
  local dot='◐'
  case "$2" in up|ok|stopped) dot='●';; down|missing|failed|timeout) dot='○';; esac
  printf '  %s%s%s  %-18s %s%-8s%s %s%s%s\n' "$3" "$dot" "$OFF" "$1" "$3" "$2" "$OFF" "$DIM" "$4" "$OFF"
}

healthy() { curl -fsS -m "${2:-4}" -o /dev/null "$1" 2>/dev/null; }

port_pid() {
  # Three environments, three tools: lsof on macOS/BSD, ss on modern Linux,
  # netstat under Git-Bash on Windows. grep -P is avoided because it refuses to
  # run under some locales.
  local port="$1" pid=''
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
  fi
  if [ -z "$pid" ] && command -v ss >/dev/null 2>&1; then
    pid=$(ss -lptn "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
  fi
  if [ -z "$pid" ] && command -v netstat >/dev/null 2>&1; then
    pid=$(netstat -ano 2>/dev/null | awk -v p=":$port" '$1 ~ /TCP/ && $2 ~ p"$" && $4 == "LISTENING" {print $5; exit}')
  fi
  echo "$pid"
}

field() { echo "$1" | cut -d'|' -f"$2"; }

start_one() {
  local key name port cwd health note cmd
  key=$(field "$1" 1); name=$(field "$1" 2); port=$(field "$1" 3)
  cwd=$(field "$1" 4); health=$(field "$1" 5); note=$(field "$1" 6); cmd=$(field "$1" 7)

  if healthy "$health" 2; then row "$name" up "$OK" "already listening on $port"; return; fi
  if [ -n "$(port_pid "$port")" ]; then
    row "$name" busy "$WARN" "port $port held but not healthy"; return
  fi
  if [ "$key" = "ollama" ] && ! command -v ollama >/dev/null 2>&1; then
    row "$name" skip "$WARN" "not installed; embeddings will fail"; return
  fi

  ( cd "$cwd" && eval "$cmd" >"$LOGDIR/$key.log" 2>"$LOGDIR/$key.err.log" & echo $! >"$PIDDIR/$key" )

  # Health, not a sleep. A service that never answers is a failure to report.
  local waited=0
  while [ "$waited" -lt 75 ]; do
    if healthy "$health" 2; then
      row "$name" up "$OK" "port $port · pid $(cat "$PIDDIR/$key" 2>/dev/null) · $note"; return
    fi
    sleep 1; waited=$((waited + 1))
  done
  row "$name" timeout "$BAD" "no health after 75s — see .logs/$key.err.log"
}

stop_one() {
  local name port key
  key=$(field "$1" 1); name=$(field "$1" 2); port=$(field "$1" 3)
  local pid; pid="$(port_pid "$port")"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true; sleep 1
    kill -9 "$pid" 2>/dev/null || true
    row "$name" stopped "$DIM" "port $port released"
  else
    row "$name" down "$DIM" "was not running"
  fi
  rm -f "$PIDDIR/$key"
}

cmd_start() {
  mkdir -p "$LOGDIR" "$PIDDIR"
  rule "Starting Lumen"
  for svc in "${SERVICES[@]}"; do start_one "$svc"; done
  rule
  printf '  Open %shttp://127.0.0.1:5173%s   %s·  logs in ./.logs/   ·  stop with%s %s./lumen.sh stop%s\n\n' \
    "$HI" "$OFF" "$DIM" "$OFF" "$HI" "$OFF"
}

cmd_stop() {
  rule "Stopping Lumen"
  # Reverse order: take the browser-facing end down before what it depends on.
  for (( i=${#SERVICES[@]}-1; i>=0; i-- )); do stop_one "${SERVICES[$i]}"; done
  printf '\n'
}

cmd_status() {
  rule "Lumen"
  local down=0
  for svc in "${SERVICES[@]}"; do
    local name port health note
    name=$(field "$svc" 2); port=$(field "$svc" 3); health=$(field "$svc" 5); note=$(field "$svc" 6)
    if healthy "$health" 3; then
      row "$name" up "$OK" "port $port · pid $(port_pid "$port") · $note"
    else
      row "$name" down "$BAD" "port $port · $note"; down=1
    fi
  done
  rule
  if [ "$down" -eq 1 ]; then
    printf '  %sNot everything is up.%s %s./lumen.sh start%s\n\n' "$WARN" "$OFF" "$HI" "$OFF"
  else
    printf '  %sAll four services answering.%s %shttp://127.0.0.1:5173%s\n\n' "$OK" "$OFF" "$HI" "$OFF"
  fi
}

cmd_logs() {
  local want="${1:-}"
  if [ -z "$want" ]; then
    printf '\n  %sWhich service?%s %sollama, glc, s17, proxy, web%s\n\n' "$WARN" "$OFF" "$HI" "$OFF"; return
  fi
  for f in "$LOGDIR/$want.log" "$LOGDIR/$want.err.log"; do
    [ -f "$f" ] && { rule "$(basename "$f")"; tail -40 "$f"; }
  done
  printf '\n'
}

cmd_doctor() {
  rule "Prerequisites"
  for tool in uv node npm git curl; do
    if command -v "$tool" >/dev/null 2>&1; then row "$tool" ok "$OK" "$(command -v "$tool")"
    else row "$tool" missing "$BAD" "not on PATH"; fi
  done
  if command -v ollama >/dev/null 2>&1; then row ollama ok "$OK" "$(command -v ollama)"
  else row ollama missing "$WARN" "embeddings will fail"; fi

  rule "Configuration"
  for pair in "glc_v5/.env:$WORKSPACE/glc_v5/.env" "S17Code/.env:$WORKSPACE/S17Code/.env"; do
    local label path; label="${pair%%:*}"; path="${pair#*:}"
    if [ -f "$path" ]; then row "$label" ok "$OK" "present"
    else row "$label" missing "$BAD" "copy from .env.example"; fi
  done

  local s17env="$WORKSPACE/S17Code/.env"
  if [ -f "$s17env" ]; then
    if grep -qE '^S17_CONTROL_TOKEN=.+' "$s17env"; then
      row "control token" ok "$OK" "set (value not shown)"
    else
      row "control token" missing "$BAD" "every write path answers 503 without it"
    fi
    local guard; guard=$(grep -E '^S17_PROTECTED_PATHS=' "$s17env" | head -1 | cut -d= -f2-)
    if [ -n "$guard" ]; then
      local n; n=$(echo "$guard" | tr ',' '\n' | grep -c .)
      if [ "$n" -lt 12 ]; then row "protected paths" narrow "$WARN" "$n patterns — DEFAULT_PROTECTED has 12"
      else row "protected paths" ok "$OK" "$n patterns"; fi
    fi
  fi

  # The constraint that actually stops a demo: 20 requests per day, per model,
  # and the keys share one project so rotation buys nothing.
  rule "Gemini quota (20/day per model, per project)"
  local glcenv="$WORKSPACE/glc_v5/.env"
  if [ ! -f "$glcenv" ]; then
    printf '  %sno glc_v5/.env to read keys from%s\n\n' "$WARN" "$OFF"; return
  fi
  local model key code
  model=$(grep -E '^GEMINI_MODEL=' "$glcenv" | head -1 | cut -d= -f2- | tr -d '\r')
  model="${model:-gemini-2.5-flash}"
  key=$(grep -E '^GEMINI_API_KEY_1=' "$glcenv" | head -1 | cut -d= -f2- | tr -d '\r')
  if [ -z "$key" ]; then printf '  %sno GEMINI_API_KEY_1%s\n\n' "$WARN" "$OFF"; return; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 -X POST \
    -H "x-goog-api-key: $key" -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":8}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent")
  if [ "$code" = "200" ]; then row "$model" ok "$OK" "quota available on key 1"
  else row "$model" exhausted "$WARN" "HTTP $code — switch GEMINI_MODEL to another bucket"; fi
  printf '\n'
}

case "${1:-status}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  doctor)  cmd_doctor ;;
  *)       printf 'usage: %s {start|stop|restart|status|logs <service>|doctor}\n' "$0"; exit 2 ;;
esac
