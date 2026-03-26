#!/bin/bash
# The Marmot Network First-Run Hook
# On first prompt (no character selected), injects context for character selection.

cat > /dev/null

CONFIG_FILE="$HOME/.themarmotnetwork/character.json"
VALID_CHARACTERS="The Marmot|The Primeagen Marmot|Theo Marmot|LowLevel Marmot"

if [ -f "$CONFIG_FILE" ]; then
  STORED_NAME=$(jq -r '.name // ""' "$CONFIG_FILE" 2>/dev/null)
  if echo "$STORED_NAME" | grep -qxE "$VALID_CHARACTERS"; then
    exit 0
  fi
fi

jq -nc '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "[The Marmot Network] The user has not chosen their marmot character yet. Before addressing their request, follow the /choose-marmot skill to let them pick one. After they choose, continue with their original request."
  }
}'
