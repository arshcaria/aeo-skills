# Player-Visible Derivations

The exporter separates raw save parsing from player-visible derivation. `export_bgee_raw_json.mjs` preserves GAME/CRE fields for audit, while `build_player_visible_export.mjs` creates the CSV.

## Source Priority

1. `BALDUR.gam` supplies party order, party gold/reputation, current area resource, embedded CRE records, selected slots, item instances, memorized/known spells, and record statistics.
2. `BALDUR.SAV` supplies compressed saved `STO` records for store-backed containers and saved `ARE` records for area containers. Match stores only when their resource name equals an item held by a party member. For SoD, parse `PlayerChest00` from saved ARE container/item sections and select the active copy by area last-saved time, with campaign-stage order as a deterministic tie-breaker. This covers BGEE bags/cases/potion containers, the SoD key ring, and the SoD player/party equipment chest without importing unrelated area containers.
3. The matching installation supplies base item and spell definitions through `chitin.key`/BIF resources and player-visible strings through `dialog.tlk`.
4. For SoD, `dlc/sod-dlc.zip` supplies the higher-priority `mod.key`, campaign BIFs, world maps, and campaign `dialog.tlk`. Loose `override` files remain highest priority.
5. Installed `2DA` tables supply Dexterity, race, lore, Wisdom spell-slot, proficiency, attack-rate, racial THAC0, style, ordinary and exceptional Strength, Constitution hit-point, monk-fist, and kit data.
6. Campaign WMP resources plus the selected `dialog.tlk` supply world-map area names. Fixed verified mappings cover areas whose WMP entries do not expose a usable label.

## Applied Modifiers

- Active effects: combine armor/accessory effects, the currently selected weapon and ammunition, permanent saved CRE effects, and saved duration effects whose absolute expiry is later than the saved game time. Do not treat weapons in inactive weapon slots as equipped modifiers.
- Attributes: apply active effects for Strength, Dexterity, Constitution, Intelligence, Wisdom, and Charisma. Preserve exceptional Strength as `18/xx`; apply `STRMOD.2DA` plus `STRMODEX.2DA` to combat bonuses.
- Hit Points: treat the CRE current/maximum fields as base values without the live Constitution adjustment. Read the current score from `HPCONBON.2DA`, distinguish warrior from non-warrior bonuses, limit bonuses to hit-die levels, divide multi-class bonuses across the participating classes, and use the `MC_WAS_*` creature flag for dual-class progression. Add the resulting Constitution adjustment to living current HP and maximum HP. Apply active equipped opcode 18 effects to base maximum HP; their current-HP change is already reflected in the saved current field.
- Armor Class: combine base armor/natural AC, saved damage-type modifiers, Dexterity, active generic/type AC effects (including combined type masks), and the active sword-and-shield style missile adjustment. Ignore a shield while a two-handed weapon is selected.
- THAC0: use the saved base THAC0 plus the current weapon/ammunition ability, the ability flags that select Strength or Dexterity, active general/missile THAC0 effects, proficiency specialization, racial weapon bonus, and the active-class non-proficiency penalty.
- Damage: use current weapon/ammunition dice and bonuses, exceptional Strength where the attack ability flags permit it, proficiency specialization, and active damage bonuses. Use the installed `FIST` item, or the `MONKFIST.2DA`-selected monk fist item, for an unarmed selection. Secondary on-hit effects are not folded into the record-screen damage range.
- Attacks per round: decode the CRE/opcode attack-rate encoding, apply current weapon/equipment effects, and add `WSPATCK.2DA` progression for active Fighter, Paladin, or Ranger components, including multi/dual classes.
- Saving throws and resistances: apply relevant active effects and their cumulative, flat-value, or percentage modes to saved CRE values. Magic Resistance uses opcode 166; opcode 31 modifies magic-damage resistance and must not be folded into the record-screen Magic Resistance value. Opcode 166 supports cumulative and flat-value modes.
- Thieving skills: combine saved allocation with race, current Dexterity, and all seven direct skill opcodes (Pick Pockets, Open Locks, Find/Disarm Traps, Move Silently, Hide In Shadows, Detect Illusion, and Set Traps). Mark inactive dual-class thief abilities.
- Lore and class skills: combine saved class lore with current Intelligence, Wisdom, and active lore effects. Emit Turn Undead level for an active Cleric component in single-, multi-, or dual-class characters.
- Spell slots: include Wisdom bonus priest slots and active slot effects. Support additive level bitmasks, double-through-level mode, and exact-level doubling; preserve prepared/available counts and sorcerer remaining-use pools.
- Container contents: bind each held container occurrence to the saved `STO` whose resource name matches that item instance, then read item identity flags, stock counts, stack quantities, and charges. Keep separate `STO` records separate when their items share one visible name. Label held containers by character, current inventory slot, and a party/slot-order ordinal for duplicate visible names. Read SoD player-chest contents from `ARE` item instances. Emit an explicit empty row for an empty held container or empty SoD party chest.

## Deliberate Exclusions

- Global or local script variables, raw effect records, offsets, resource references, and byte dumps are audit data, not player-visible data.
- Plot interpretation, quest inference, tactical recommendations, and judgments about character quality are outside the export.
- Runtime-only states that are not represented by the saved GAME/CRE record or installed static resources may differ until the game recalculates them after loading.

## Validation

`validate_bgee_raw_json.mjs` compares parsed values and embedded byte ranges back to the source GAM and reports a pass/fail summary. SAV parsing range-checks every selected STO and ARE container/item record. Resource validation rejects missing party items, container-content items, party-chest items, or spells across the applicable base/DLC layers. Container validation requires `BALDUR.SAV`, one unambiguous saved `STO` record per held container resource, and a matching record for every party-held container item. The visible builder then checks the CSV shape and rejects cells that exactly leak any current area, selected party-chest area/container name, character, item, or spell resource identifier.
