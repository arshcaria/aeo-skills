---
name: export-bgee-visible-save
description: >-
  Parse Baldur's Gate: Enhanced Edition (BGEE) and Siege of Dragonspear (SoD)
  GAME V2.0 saves and export timestamped CSV party data as the player sees it
  after game-rule and equipped-item modifiers, including contents of bags,
  scroll cases, potion containers, SoD key rings, multiple same-named magic
  containers, and the SoD player/party equipment chest. Use for requests to analyze the
  latest or a specified save from save/sodsave, refresh BGEE/SOD player-visible
  exports, or export party overview, member details, equipment, proficiencies,
  spells, and objective data notes without internal resource identifiers or
  subjective commentary.
---

# Export BGEE/SoD Player-Visible Save Data

Create a reproducible `BGEE_team_player_visible_<timestamp>.csv` or `SOD_team_player_visible_<timestamp>.csv`. Treat the installed game's base resources and, for SoD, the mounted `dlc/sod-dlc.zip` resource layer as the source for display strings and rule modifiers.

## Workflow

1. Identify the save input.
   - Use a path supplied by the user when present.
   - Otherwise compare valid saves under both `save` and `sodsave` and use the newest `BALDUR.gam` modification time.
   - Accept a save directory containing `BALDUR.gam`, a direct `BALDUR.gam`, or a BGEE/SoD save ZIP.
2. Identify the matching BGEE/SoD installation directory containing `chitin.key`.
   - Prefer `--game-dir` supplied by the user or `BGEE_GAME_DIR`.
   - Check normal Steam and GOG locations before performing any broader read-only search.
   - For an SoD save, require `dlc/sod-dlc.zip` or an explicit `--dlc-zip` path.
3. Run `scripts/export_visible_save.mjs` with absolute paths. The script detects SoD from `current_campaign=SOD`, reads party-held stores and the active saved `PlayerChest00` ARE container from `BALDUR.SAV`, and applies resource precedence `override > sod-dlc > base`.
4. Confirm that the command completed all three validations:
   - GAME signature/version and raw byte-field checks.
   - Installed resource extraction with no missing party, container-content, party-chest, or spell resources and no missing saved store for a party-held container.
   - Seven-column CSV structure and no internal resource identifier leakage.
5. Return the final CSV path and summarize the selected save, party count, row count, and resolved area name. Treat the raw JSON and extracted resources as audit intermediates, not as the player-visible deliverable.

## Command

```powershell
node <skill-directory>\scripts\export_visible_save.mjs `
  --game-dir "C:\path\to\BGEE" `
  --output-dir "C:\path\to\workspace\outputs\latest_save_YYYYMMDD_HHMMSS"
```

Without `--save` or `--save-root`, scan both default save folders. Repeat `--save-root <path>` to limit or extend the search. Use `--save <path>` for one save and `--dlc-zip <path>` for a nonstandard SoD archive location. Use `--language en_US` unless the user requests another installed language. Use `--area-name <text>` only when the area is absent from WMP resources and a player-visible name can be verified; never expose `ARxxxx` or `BDxxxx` as a visible name.

## Output Contract

The visible CSV must:

- use `BGEE_team_player_visible_<timestamp>.csv` for BGEE or `SOD_team_player_visible_<timestamp>.csv` for SoD;
- contain the sections `TEAM OVERVIEW`, `MEMBER DETAILS`, `EQUIPMENT`, `CONTAINER CONTENTS`, `PROFICIENCIES`, `SPELLS`, and `DATA NOTES` when the party holds containers;
- list the saved contents of party-held gem bags, scroll cases, potion containers, other store-backed containers, SoD key rings, and the active SoD player/party equipment chest, including objective counts or charges;
- label every held container with its current inventory slot and number duplicate visible names in party/slot order, so multiple `Gem Bag` instances remain distinguishable even on one character;
- report current, modified values for Armor Class, THAC0, damage, attacks per round, attributes, saving throws, resistances, thieving skills, lore, and spell slots where supported;
- use names from the selected installed game language;
- contain no Chinese text unless it comes from the selected game-language resources or player-authored save data;
- contain no raw resource references, offsets, effect records, local variables, or subjective interpretation;
- avoid plot summaries or inferred narrative context.

Do not copy raw identifiers into the CSV when a source string cannot be resolved. Use an objective placeholder such as `Unknown Area`, `Unknown Spell`, or `Unknown Proficiency` and report the unresolved field separately.

## Accuracy Rules

- Support BGEE/SoD `GAME V2.0`; reject other signatures or versions instead of guessing.
- Derive visible values from the save plus matching base and campaign resource layers.
- Keep the selected weapon/ammunition loadout and active equipment state when calculating combat values.
- Preserve unidentified item names when the saved item is not identified.
- Require `BALDUR.SAV` when the party holds a container and reject missing matching saved `STO` records instead of reporting an empty container.
- Bind each held container to its exact saved `STO` resource and keep differently backed containers separate even when their player-visible names are identical.
- For SoD, select the active `PlayerChest00` from saved ARE records by the area's last-saved time; use campaign-stage order only as a deterministic tie-breaker. Keep BGEE output behavior unchanged.
- Mark inactive dual-class proficiencies or thieving abilities instead of treating them as active.
- Do not overwrite or delete existing exports. Use a new timestamped output directory.

Read [references/player-visible-derivations.md](references/player-visible-derivations.md) before changing calculation logic or explaining field coverage.
