# Player-Visible Derivations

The exporter separates raw save parsing from player-visible derivation. `export_bgee_raw_json.mjs` preserves GAME/CRE fields for audit, while `build_player_visible_export.mjs` creates the CSV.

## Source Priority

1. `BALDUR.gam` supplies party order, party gold/reputation, current area resource, embedded CRE records, selected slots, item instances, memorized/known spells, and record statistics.
2. The matching BGEE installation supplies item and spell definitions through `chitin.key`/BIF resources and player-visible strings through `dialog.tlk`.
3. Installed `2DA` tables supply Dexterity, race, lore, Wisdom spell-slot, proficiency, attack-rate, racial THAC0, style, Strength, and kit data.
4. `WORLDMAP.WMP` plus `dialog.tlk` supplies world-map area names. A fixed mapping covers the nine Baldur's Gate city districts whose WMP entries do not expose a usable label.

## Applied Modifiers

- Attributes: apply active equipped-item effects for Strength, Dexterity, Constitution, Intelligence, Wisdom, and Charisma.
- Armor Class: combine base armor/natural AC, Dexterity, active generic/type AC effects, and the active sword-and-shield style missile adjustment. Ignore a shield while a two-handed weapon is selected.
- THAC0: use the saved base THAC0 plus the current weapon/ammunition ability, Strength or Dexterity, active equipment, proficiency specialization, racial weapon bonus, and the class-appropriate non-proficiency penalty.
- Damage: use current weapon/ammunition dice and bonuses, Strength where the attack permits it, proficiency specialization, and active equipped damage bonuses. Secondary on-hit effects are not folded into the record-screen damage range.
- Attacks per round: use the saved attack rate, current weapon/equipment attack-rate effects, and fighter specialization/level progression.
- Saving throws and resistances: apply relevant active equipped-item effects to saved CRE values.
- Thieving skills: combine saved allocation with race, current Dexterity, and active equipped-item modifiers. Mark inactive dual-class thief abilities.
- Lore: combine saved class lore with current Intelligence and Wisdom modifiers.
- Spell slots: include Wisdom bonus priest slots and active equipped-item slot effects. Preserve prepared/available counts and sorcerer remaining-use pools.

## Deliberate Exclusions

- Global or local script variables, raw effect records, offsets, resource references, and byte dumps are audit data, not player-visible data.
- Plot interpretation, quest inference, tactical recommendations, and judgments about character quality are outside the export.
- Runtime-only states that are not represented by the saved GAME/CRE record or installed static resources may differ until the game recalculates them after loading.

## Validation

`validate_bgee_raw_json.mjs` compares parsed values and embedded byte ranges back to the source GAM and reports a pass/fail summary. The visible builder then checks the CSV shape and rejects cells that exactly leak any current area, character, item, or spell resource identifier.
