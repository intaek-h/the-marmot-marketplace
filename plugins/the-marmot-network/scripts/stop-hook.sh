#!/bin/bash
# The Marmot Network Stop Hook
# Runs after every Claude response. Analyzes new transcript lines
# and blocks Claude if the session may contain transferable knowledge.

INPUT=$(cat)

LOG_DIR="${CLAUDE_PLUGIN_ROOT}/logs"
LOG_FILE="${LOG_DIR}/stop-hook.log"
MARKER_DIR="${LOG_DIR}/markers"
mkdir -p "$MARKER_DIR"

# Loop guard: if Claude is already handling a block, let it stop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  echo "[$(date -Iseconds)] stop_hook_active=true, allowing stop" >> "$LOG_FILE"
  exit 0
fi

# Get transcript path
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Incremental analysis: only score lines added since last check
MARKER_FILE="${MARKER_DIR}/$(basename "$TRANSCRIPT_PATH").offset"
LAST_OFFSET=0
if [ -f "$MARKER_FILE" ]; then
  LAST_OFFSET=$(cat "$MARKER_FILE")
fi

TOTAL_LINES=$(wc -l < "$TRANSCRIPT_PATH" | tr -d ' ')
echo "$TOTAL_LINES" > "$MARKER_FILE"

if [ "$TOTAL_LINES" -le "$LAST_OFFSET" ]; then
  exit 0
fi

# Run heuristic on new lines
ANALYSIS=$(tail -n +"$((LAST_OFFSET + 1))" "$TRANSCRIPT_PATH" \
  | npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/detect-shareable.ts" 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$ANALYSIS" ]; then
  echo "[$(date -Iseconds)] analysis failed or empty" >> "$LOG_FILE"
  exit 0
fi

echo "[$(date -Iseconds)] heuristic: $(echo "$ANALYSIS" | jq -c '.')" >> "$LOG_FILE"

SHAREABLE=$(echo "$ANALYSIS" | jq -r '.shareable // false')
if [ "$SHAREABLE" != "true" ]; then
  echo "[$(date -Iseconds)] not shareable (score below threshold)" >> "$LOG_FILE"
  exit 0
fi

# Read character name from config, validate against known roster
CHARACTER_NAME="The Marmot"
VALID_CHARACTERS="The Marmot|The Primeagen Marmot|Theo Marmot|LowLevel Marmot"
CONFIG_FILE="$HOME/.themarmotnetwork/character.json"
if [ -f "$CONFIG_FILE" ]; then
  STORED_NAME=$(jq -r '.name // ""' "$CONFIG_FILE" 2>/dev/null)
  if echo "$STORED_NAME" | grep -qxE "$VALID_CHARACTERS"; then
    CHARACTER_NAME="$STORED_NAME"
  fi
fi

# Block Claude and trigger the share-solution skill
echo "[$(date -Iseconds)] blocking — score above threshold" >> "$LOG_FILE"
jq -nc --arg reason "[🦫...!!] $CHARACTER_NAME thinks there is transferable knowledge worth sharing. Call the hey_marmot_get_evaluation_criteria tool with character \"$CHARACTER_NAME\" to get the guidelines, then assess whether this session produced transferable knowledge. If yes, follow the /share-solution skill. Otherwise, conclude normally." \
  '{decision: "block", reason: $reason}'
exit 0
