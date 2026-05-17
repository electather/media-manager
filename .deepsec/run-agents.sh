#!/usr/bin/env bash
# Orchestrates 4 local deepsec fix agents, staggered 1.5h apart.
# Usage:
#   ./run-agents.sh start   # schedule all 4 agents in background (default)
#   ./run-agents.sh status  # print current status of each agent

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEEPSEC="$REPO/.deepsec"
STATUS_DIR="$DEEPSEC/status"
PROMPT_DIR="$DEEPSEC/prompts"
LOG_DIR="$DEEPSEC/logs"

# Fire times (UTC). Adjust if you're running this later than planned.
FIRE_TIMES=(
  ""                        # [0] unused
  "2026-05-18T01:00:00Z"   # [1] agent 1 — issues #285–#301
  "2026-05-18T02:30:00Z"   # [2] agent 2 — issues #302–#318
  "2026-05-18T04:00:00Z"   # [3] agent 3 — issues #319–#335
  "2026-05-18T05:30:00Z"   # [4] agent 4 — issues #336–#351
)

LABELS=(
  ""
  "#285–#301 (BUG)"
  "#302–#318 (BUG/CRITICAL)"
  "#319–#335 (HIGH/MEDIUM)"
  "#336–#351 (MEDIUM)"
)

# ─── helpers ─────────────────────────────────────────────────────────────────

set_status() {
  mkdir -p "$STATUS_DIR"
  printf '%s' "$2" > "$STATUS_DIR/agent-$1.status"
}

get_status() {
  cat "$STATUS_DIR/agent-$1.status" 2>/dev/null || printf 'pending'
}

# Sleep until a UTC ISO-8601 timestamp, cross-platform (macOS + Linux).
wait_until() {
  local ts="$1"
  local target
  if date --version >/dev/null 2>&1; then
    target=$(date -d "$ts" +%s)            # GNU date (Linux)
  else
    target=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s)  # BSD date (macOS)
  fi
  local now; now=$(date +%s)
  local diff=$(( target - now ))
  if (( diff > 0 )); then
    echo "[$(date -u +%H:%M:%SZ)] Sleeping ${diff}s until $ts"
    sleep "$diff"
  fi
}

# ─── run one agent ───────────────────────────────────────────────────────────

run_agent() {
  local n="$1"
  local log="$LOG_DIR/agent-$n.log"
  mkdir -p "$LOG_DIR"

  set_status "$n" "running"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Agent $n (${LABELS[$n]}) started" | tee -a "$log"

  local exit_code=0
  (cd "$REPO" && claude --dangerously-skip-permissions --print \
    "$(cat "$PROMPT_DIR/agent-$n.txt")") >> "$log" 2>&1 || exit_code=$?

  if (( exit_code == 0 )); then
    set_status "$n" "succeeded"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Agent $n succeeded" | tee -a "$log"
  else
    set_status "$n" "failed (exit $exit_code)"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Agent $n failed (exit $exit_code)" | tee -a "$log"
  fi
}

# ─── schedule one agent in background ────────────────────────────────────────

schedule_agent() {
  local n="$1"
  (
    set_status "$n" "pending"
    wait_until "${FIRE_TIMES[$n]}"
    run_agent "$n"
  ) &
  echo "  agent $n  pid $!  fires at ${FIRE_TIMES[$n]}"
}

# ─── status display ──────────────────────────────────────────────────────────

show_status() {
  printf '\n%-8s  %-26s  %-10s  %s\n' "AGENT" "ISSUES" "STATUS" "FIRE TIME (UTC)"
  printf '%s\n' "----------------------------------------------------------------------"
  for n in 1 2 3 4; do
    local s; s=$(get_status "$n")
    printf '%-8s  %-26s  %-10s  %s\n' \
      "agent-$n" "${LABELS[$n]}" "$s" "${FIRE_TIMES[$n]}"
  done
  printf '\n'
  echo "Logs: tail -f $LOG_DIR/agent-N.log"
}

# ─── main ─────────────────────────────────────────────────────────────────────

cmd="${1:-start}"

case "$cmd" in
  start)
    echo "Scheduling 4 agents..."
    for n in 1 2 3 4; do
      schedule_agent "$n"
    done
    echo ""
    echo "All 4 agents scheduled. This process must stay alive."
    echo "Run in a new terminal: watch -n 60 $0 status"
    echo ""
    wait  # Keep the parent alive so background jobs don't get killed.
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 [start|status]"
    exit 1
    ;;
esac
