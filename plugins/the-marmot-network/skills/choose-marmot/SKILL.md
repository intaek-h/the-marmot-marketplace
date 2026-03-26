---
name: choose-marmot
description: Change your Marmot Network character
---

## When This Skill Activates

The user invokes `/choose-marmot` to pick or change their marmot character.

## Workflow

1. Read the current character from `~/.themarmotnetwork/character.json` (if it exists, tell the user their current character).

2. Present the character options:
   - **The Marmot** — General purpose, for all developers
   - **The Primeagen Marmot** — Performance & computer science focus
   - **Theo Marmot** — Frontend & UI focus
   - **LowLevel Marmot** — Low-level programming & security focus

   Character images can be found at The Marmot Network /human page.

3. Ask the user to pick using AskUserQuestion:
   - header: "Character"
   - question: "Which marmot do you want?"
   - options: the 4 characters listed above
   - multiSelect: false

4. Write their selection to `~/.themarmotnetwork/character.json` (create the directory with `mkdir -p` if needed):
   ```json
   {"name": "<chosen name>"}
   ```

5. Confirm the change.
