---
name: export-bgee-visible-save
description: >-
  Parse Baldur's Gate: Enhanced Edition (BGEE), standalone Siege of Dragonspear
  (SoD), and Enhanced Edition Trilogy (EET) GAME V2.0 saves and export
  timestamped player-visible CSV party data after game-rule and equipped-item
  modifiers. Use for the latest or a specified BGEE/SoD/EET save, including EET
  BG1, SoD, Shadows of Amn, and Throne of Bhaal stages; party-held containers;
  and the SoD player/party equipment chest.
---

# Export BGEE, SoD, or EET Player-Visible Save Data

Create a reproducible `<campaign>_team_player_visible_<timestamp>.csv` from the save plus its matching installed resources. Supported EET campaign tags are `EET_BG1`, `EET_SOD`, `EET_SOA`, and `EET_TOB`.

## Workflow

1. Identify the save input.
   - Use a path supplied by the user when present.
   - Otherwise select the newest valid `BALDUR.gam` from the detected installation's default save roots: BGEE uses `save` and `sodsave`; EET uses the Trilogy `save` directory.
   - Accept a save directory containing `BALDUR.gam`, a direct `BALDUR.gam`, or a save ZIP.
2. Identify the matching installation containing `chitin.key`.
   - Prefer `--game-dir`, then `EET_GAME_DIR` or `BGEE_GAME_DIR`, before known local, Steam, and GOG locations.
   - Detect EET from `engine.lua` or its EET installation directories.
   - Treat EET's `chitin.key`, `override`, and selected `lang/<language>/dialog.tlk` as one integrated resource layer. Never mount a standalone BGEE `sod-dlc.zip` over EET.
   - For standalone SoD only, require `dlc/sod-dlc.zip` or `--dlc-zip` and apply precedence `override > sod-dlc > base`.
3. Run `scripts/export_visible_save.mjs` with absolute paths. It detects EET stages from `current_campaign` (`BG1`, `SOD`, `SOA`/`BG2`/`BG2EE`, or `TOB`), reads party-held stores, and reads the active SoD `PlayerChest00` ARE container from `BALDUR.SAV`.
4. Confirm that all validations completed:
   - GAME signature/version and raw byte-field checks.
   - Installed resource extraction with no missing party, container, party-chest, or spell resources and no missing saved store for a party-held container.
   - Seven-column CSV structure, finite derived values, and no internal resource identifier leakage.
5. Return the CSV path and summarize the installation type, campaign stage, selected save, party count, row count, and resolved area name. Treat raw JSON and extracted resources as audit intermediates.

## Command

```powershell
node <skill-directory>\scripts\export_visible_save.mjs `
  --game-dir "C:\path\to\BG2EE-EET" `
  --output-dir "C:\path\to\workspace\outputs\latest_save_YYYYMMDD_HHMMSS"
```

Repeat `--save-root <path>` to limit or extend discovery. Use `--save <path>` for one save and `--language en_US` unless the user requests another installed language. Use `--dlc-zip` only for standalone SoD. Use `--area-name <text>` only when WMP resources do not expose a verified player-visible name; never expose an area resource identifier as a visible name.

## Output Contract

The visible CSV must:

- use `BGEE_...` or `SOD_...` for standalone games and `EET_BG1_...`, `EET_SOD_...`, `EET_SOA_...`, or `EET_TOB_...` for EET;
- contain `TEAM OVERVIEW`, `MEMBER DETAILS`, `EQUIPMENT`, `PROFICIENCIES`, `SPELLS`, and `DATA NOTES`, plus `CONTAINER CONTENTS` when applicable;
- list saved contents of party-held bags, cases, potion containers, other store-backed containers, SoD key rings, and the active SoD player/party equipment chest with objective counts or charges;
- label every held container with its current inventory slot and number duplicate visible names in party/slot order;
- report current modified Hit Points, Armor Class, THAC0, damage, attacks per round, attributes including `18/xx` Strength, saving throws, resistances, thieving skills, lore, class skills, and supported spell slots;
- use names from the selected installed game language;
- contain no raw resource references, offsets, effect records, local variables, or subjective interpretation.

When a display string cannot be resolved, use an objective placeholder such as `Unknown Area`, `Unknown Spell`, or `Unknown Proficiency` and report the unresolved field separately.

## Accuracy Rules

- Support only `GAME V2.0`; reject other signatures or versions.
- Derive values from the save and the exact matching installation. For EET this means the live integrated EET resource stack, including installed WeiDU overrides.
- Keep the selected weapon/ammunition loadout and active equipment state when calculating combat values; include the installed fist or monk-fist resource for an unarmed selection.
- Apply directly relevant permanent and unexpired saved CRE effects in addition to active item effects.
- Derive Hit Points from raw CRE values, current Constitution, single/multi/dual-class hit-die rules, and active equipped maximum-HP effects.
- Preserve unidentified item names when the saved item is unidentified.
- Require `BALDUR.SAV` for party-held containers and reject missing matching saved `STO` records.
- Bind each held container to its exact saved `STO` resource and keep differently backed containers separate even when their visible names match.
- During the SoD stage, select the active `PlayerChest00` from saved ARE records by last-saved time, using campaign-stage order only as a deterministic tie-breaker.
- Mark inactive dual-class proficiencies or thieving abilities.
- Never overwrite an existing export; use a new timestamped output directory.

Read [references/player-visible-derivations.md](references/player-visible-derivations.md) before changing calculation logic or explaining field coverage.
