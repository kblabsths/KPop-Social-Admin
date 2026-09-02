#!/bin/zsh
# AgenticFlow watchdog — keeps a mid-flight run alive across session death
# (quota cutoff, crash, reboot). Installed as LaunchAgent
# com.agenticflow.watchdog, fired every 15 minutes.
#
# Semantics:
#   tracker/RUNNING exists      -> a run is in flight (the kill switch)
#   tracker/PARKED exists       -> campaign unfinished but nothing alive —
#                                  demoted below after repeated no-progress
#                                  relaunches; /ship resume promotes it back
#   tracker/SESSION_LOCK        -> PID of the session that owns the run
# A run with no living session gets relaunched INTO A NAMED TMUX SESSION —
# a real interactive seat the human can always claim (`tmux attach -t
# af-<project>`, recorded in tracker/ATTACH, shown in the UI, sent in the
# push). Never headless -p when tmux exists: -p has no surface and murders
# in-flight background agents at print mode's 600s ceiling (2026-07-28/30).
# If quota is exhausted the launch fails cheaply and the next firing
# retries — quota refresh is handled by persistence, not by a timer.
#
# Stalls (PID alive, HEARTBEAT frozen): our tmux seat gets ONE nudge
# (send-keys /ship auto-resume) per stall episode; a human's own terminal
# is never touched — one attention push per episode instead. Episode
# boundary = HEARTBEAT newer than the .stall_notified marker.

# self-locate: the factory home (tracker/, run.yaml) is this script's
# parent dir; the PROJECT root (.claude/, where the session must start) is
# one level above it — so a transplanted copy watches ITS project
FACTORY="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(dirname "$FACTORY")"
LOCK="$FACTORY/tracker/SESSION_LOCK"
LOG="$FACTORY/tracker/watchdog.log"
# launchd's PATH is bare /usr/bin:/bin — without this, tmux (homebrew) and
# claude (~/.local/bin) vanish and every relaunch silently degrades headless
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
TMUX_BIN="$(command -v tmux)"
SLUG="af-$(basename "$PROJECT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//')"
STALL_MARK="$FACTORY/tracker/.stall_notified"

notify_attention() {  # $1 title, $2 body — best-effort, never fails us
    python3 "$FACTORY/scripts/notify.py" attention --title "$1" --body "$2" > /dev/null 2>&1
}

cd "$PROJECT" || exit 1
[ -f "$FACTORY/tracker/RUNNING" ] || exit 0        # no run in flight — nothing to do

if [ -f "$LOCK" ]; then
    pid=$(tr -cd '0-9' < "$LOCK")
    if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
        # Session alive — but is it moving? A turn-end stall (PID alive, turn
        # over, nothing pending to re-invoke the dispatcher) never trips the
        # PID check. dispatch.py touches tracker/HEARTBEAT every tick; if the
        # heartbeat belongs to this run (newer than RUNNING) and hasn't moved
        # in STALL_MIN minutes, the run is stalled. 45 min, not 30: a 25-min
        # tick gap was observed on a HEALTHY run (dispatcher parked waiting
        # on a background builder), so 30 cuts too close.
        STALL_MIN=45
        HB="$FACTORY/tracker/HEARTBEAT"
        stale=""
        announced="no"
        if [ -f "$HB" ] && [ "$HB" -nt "$FACTORY/tracker/RUNNING" ]; then
            # real activity (heartbeat OR ledger OR live transcript) + whether
            # the run already announced a human-wait — see stall_probe.py
            # (2026-07-31: heartbeat-only false-positived on an endgame walk)
            probe=$(python3 "$FACTORY/scripts/stall_probe.py" "$FACTORY" "$PROJECT" 2>/dev/null)
            age="${probe%% *}"
            announced="${probe##* }"
            [ -n "$age" ] && [ "$age" -gt $(( STALL_MIN * 60 )) ] && stale="$age"
        fi
        [ -n "$stale" ] || exit 0   # moving (or pre-first-tick) — leave it alone
        if [ "$announced" = "yes" ]; then
            # the run already told the human it is waiting (gate question,
            # blocked ask); his silence is intentional — one push per pause,
            # and never type into a session that is showing him a question
            exit 0
        fi
        pane=""
        [ -n "$TMUX_BIN" ] && pane=$("$TMUX_BIN" list-panes -t "$SLUG" -F '#{pane_pid}' 2>/dev/null | head -1)
        if [ -n "$pane" ] && [ "$pane" = "$pid" ]; then
            # Our tmux seat: nudge, never kill — an idle prompt executes the
            # command (the 529-abort recovery), a mid-turn session queues it.
            # Once per stall episode, or a swallowed nudge would repeat 4x/h.
            if [ ! -f "$STALL_MARK" ] || [ "$HB" -nt "$STALL_MARK" ]; then
                echo "$(date '+%F %T') stall: HEARTBEAT ${stale}s stale, tmux seat $SLUG (pid $pid) — nudging /ship auto-resume" >> "$LOG"
                "$TMUX_BIN" send-keys -t "$SLUG" "/ship auto-resume" Enter
                notify_attention "Factory stalled — nudged the seat" \
                    "No movement for $((stale/60)) min; sent /ship auto-resume into the session. Attach: tmux attach -t $SLUG"
                touch "$STALL_MARK"
            fi
            exit 0
        elif ps -p "$pid" -o command= | grep -q -- ' -p '; then
            # Legacy headless session (claude -p): nobody is typing in it —
            # kill the stalled process and fall through to the relaunch.
            echo "$(date '+%F %T') stall: HEARTBEAT ${stale}s stale, headless session $pid — killing and relaunching" >> "$LOG"
            kill "$pid" 2>/dev/null
            sleep 5
            ps -p "$pid" > /dev/null 2>&1 && kill -9 "$pid" 2>/dev/null
        else
            # A human's own terminal: killing it could eat an in-progress
            # conversation. One attention push per stall episode; recovery
            # stays with the human.
            echo "$(date '+%F %T') stall: HEARTBEAT ${stale}s stale but session $pid is interactive — not touching it (resume /ship or delete tracker/RUNNING)" >> "$LOG"
            if [ ! -f "$STALL_MARK" ] || [ "$HB" -nt "$STALL_MARK" ]; then
                notify_attention "Factory stalled — needs you" \
                    "No movement for $((stale/60)) min and the session is in your own terminal; resume /ship there (or delete tracker/RUNNING to end the run)."
                touch "$STALL_MARK"
            fi
            exit 0
        fi
    fi
fi

# Bounded recovery: each relaunch stamps a counter; observed progress
# (HEARTBEAT newer than the stamp) clears it. A 4th consecutive no-progress
# arrival PARKS the campaign instead of relaunching — RUNNING becomes
# tracker/PARKED: campaign unfinished, no process alive, gates disarmed;
# a human /ship resume promotes it back. Endless relaunch of a run that
# dies on arrival is how week-old zombie RUNNING files were born.
ATTEMPTS="$FACTORY/tracker/.relaunch_attempts"
HB="$FACTORY/tracker/HEARTBEAT"
[ -f "$ATTEMPTS" ] && [ -f "$HB" ] && [ "$HB" -nt "$ATTEMPTS" ] && rm -f "$ATTEMPTS"
n=0
[ -f "$ATTEMPTS" ] && n=$(tr -cd '0-9' < "$ATTEMPTS")
if [ "${n:-0}" -ge 3 ]; then
    mv "$FACTORY/tracker/RUNNING" "$FACTORY/tracker/PARKED"
    rm -f "$ATTEMPTS" "$LOCK" "$STALL_MARK"
    echo "$(date '+%F %T') parked: $n relaunches with no progress — RUNNING -> PARKED (resume with /ship)" >> "$LOG"
    notify_attention "Factory parked — needs you" \
        "Relaunched $n times with no progress; campaign parked (work preserved, gates disarmed). Resume with /ship in the project, or leave it parked."
    exit 0
fi
echo $(( ${n:-0} + 1 )) > "$ATTEMPTS"

CLAUDE="/Users/ben-m4/.local/bin/claude"
command -v claude > /dev/null 2>&1 && CLAUDE=$(command -v claude)
[ -x "$CLAUDE" ] || { echo "$(date '+%F %T') claude binary not found" >> "$LOG"; exit 1; }

closing=""
[ -f "$FACTORY/tracker/CLOSING" ] && closing=" (CLOSING marker present — session died mid-close; relaunch will finish the close, not resume work)"
echo "$(date '+%F %T') RUNNING present, no live session — relaunching /ship$closing" >> "$LOG"

if [ -n "$TMUX_BIN" ]; then
    "$TMUX_BIN" kill-session -t "$SLUG" 2>/dev/null   # a dead seat's empty shell
    if "$TMUX_BIN" new-session -d -s "$SLUG" -c "$PROJECT" \
        "$CLAUDE '/ship auto-resume' --dangerously-skip-permissions"; then
        pane=$("$TMUX_BIN" list-panes -t "$SLUG" -F '#{pane_pid}' 2>/dev/null | head -1)
        if [ -n "$pane" ]; then
            echo "$pane" > "$LOCK"      # Phase 0 will overwrite with its own view
            echo "tmux attach -t $SLUG" > "$FACTORY/tracker/ATTACH"
            echo "$(date '+%F %T') relaunched in tmux seat $SLUG (pid $pane)" >> "$LOG"
            notify_attention "Factory relaunched" \
                "Session was dead$closing; relaunched /ship auto-resume. Attach: tmux attach -t $SLUG"
            exit 0
        fi
    fi
    echo "$(date '+%F %T') tmux launch failed — headless fallback" >> "$LOG"
fi

# no tmux: headless fallback, but never murder background agents at 600s
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
"$CLAUDE" -p "/ship auto-resume" --dangerously-skip-permissions >> "$LOG" 2>&1 &
pid=$!
echo "$pid" > "$LOCK"                   # Phase 0 will overwrite with its own view
wait "$pid"
echo "$(date '+%F %T') session $pid exited (status $?)" >> "$LOG"
