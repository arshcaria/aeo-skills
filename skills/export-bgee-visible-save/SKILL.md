---
name: export-bgee-visible-save
description: >-
  Parse a Baldur's Gate: Enhanced Edition (BGEE) GAME V2.0 save and export a
  timestamped CSV of party data as the player sees it after game-rule and
  equipped-item modifiers. Use for requests to analyze the latest or a specified
  BGEE save, refresh BGEE_team_player_visible_[timestamp].csv, or export party
  overview, member details, equipment, proficiencies, spells, and objective data
  notes without internal resource identifiers or subjective commentary.
---

# Export BGEE Player-Visible Save Data

Create a reproducible `BGEE_team_player_visible_<timestamp>.csv` from a BGEE save. Treat the installed game's `ITM`, `SPL`, `2DA`, `WMP`, and `TLK` resources as the source for display strings and rule modifiers.

## Workflow

1. Identify the save input.
   - Use a path supplied by the user when present.
   - Otherwise use the newest valid save under the BGEE save folder.
   - Accept a save directory containing `BALDUR.gam`, a direct `BALDUR.gam`, or a BGEE save ZIP.
2. Identify the matching BGEE installation directory containing `chitin.key`.
   - Prefer `--game-dir` supplied by the user or `BGEE_GAME_DIR`.
   - Check normal Steam and GOG locations before performing any broader read-only search.
3. Run `scripts/export_visible_save.mjs` with absolute paths.
4. Confirm that the command completed all three validations:
   - GAME signature/version and raw byte-field checks.
   - Installed resource extraction with no missing party items or spells.
   - Seven-column CSV structure and no internal resource identifier leakage.
5. Return the final CSV path and summarize the selected save, party count, row count, and resolved area name. Treat the raw JSON and extracted resources as audit intermediates, not as the player-visible deliverable.

## Command

```powershell
node <skill-directory>\scripts\export_visible_save.mjs `
  --game-dir "C:\path\to\BGEE" `
  --save-root "C:\Users\name\Documents\Baldur's Gate - Enhanced Edition\save" `
  --output-dir "C:\path\to\workspace\outputs\latest_save_YYYYMMDD_HHMMSS"
```

Use `--save <path>` to select a specific save. Use `--language en_US` unless the user requests another installed game language. Use `--area-name <text>` only when the current area is absent from `WORLDMAP.WMP` and a player-visible name can be verified; never expose an `ARxxxx` resource identifier as the visible area name.

## Output Contract

The visible CSV must:

- use the exact filename pattern `BGEE_team_player_visible_<timestamp>.csv`;
- contain the sections `TEAM OVERVIEW`, `MEMBER DETAILS`, `EQUIPMENT`, `PROFICIENCIES`, `SPELLS`, and `DATA NOTES`;
- report current, modified values for Armor Class, THAC0, damage, attacks per round, attributes, saving throws, resistances, thieving skills, lore, and spell slots where supported;
- use names from the selected installed game language;
- contain no Chinese text unless it comes from the selected game-language resources or player-authored save data;
- contain no raw resource references, offsets, effect records, local variables, or subjective interpretation;
- avoid plot summaries or inferred narrative context.

Do not copy raw identifiers into the CSV when a source string cannot be resolved. Use an objective placeholder such as `Unknown Area`, `Unknown Spell`, or `Unknown Proficiency` and report the unresolved field separately.

## Accuracy Rules

- Support BGEE `GAME V2.0`; reject other signatures or versions instead of guessing.
- Derive visible values from the save plus resources from the matching game installation.
- Keep the selected weapon/ammunition loadout and active equipment state when calculating combat values.
- Preserve unidentified item names when the saved item is not identified.
- Mark inactive dual-class proficiencies or thieving abilities instead of treating them as active.
- Do not overwrite or delete existing exports. Use a new timestamped output directory.

Read [references/player-visible-derivations.md](references/player-visible-derivations.md) before changing calculation logic or explaining field coverage.
