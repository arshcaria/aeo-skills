import crypto from "node:crypto";
import fs from "node:fs/promises";

const gamPath = process.argv[2];
const jsonPath = process.argv[3];
const zipPath = process.argv[4] || null;

if (!gamPath || !jsonPath) {
  throw new Error("Usage: node validate_bgee_raw_json.mjs <BALDUR.gam> <raw.json> [source.zip]");
}

const gam = await fs.readFile(gamPath);
const jsonText = await fs.readFile(jsonPath, "utf8");
const parsed = JSON.parse(jsonText);
const checks = [];

function check(name, condition, details = null) {
  checks.push({ name, passed: Boolean(condition), details });
}

function equalBytes(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fixedString(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  const value = end >= 0 ? raw.subarray(0, end) : raw;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return value.toString("latin1");
  }
}

const u8 = (o) => gam.readUInt8(o);
const i8 = (o) => gam.readInt8(o);
const u16 = (o) => gam.readUInt16LE(o);
const i16 = (o) => gam.readInt16LE(o);
const u32 = (o) => gam.readUInt32LE(o);
const i32 = (o) => gam.readInt32LE(o);
const from64 = (value) => Buffer.from(value, "base64");

const rootKeys = Object.keys(parsed);
const requiredRootKeys = ["source", "game_header", "party_members"];
const allowedRootKeys = new Set([...requiredRootKeys, "container_source_available", "container_stores"]);
check("json_has_expected_root_keys", requiredRootKeys.every((key) => rootKeys.includes(key)) && rootKeys.every((key) => allowedRootKeys.has(key)));
check("gam_size_matches", parsed.source.gam_size_bytes === gam.length, { actual: gam.length, json: parsed.source.gam_size_bytes });
check("gam_sha256_matches", parsed.source.gam_sha256 === sha256Buffer(gam));
if (zipPath) {
  const zip = await fs.readFile(zipPath);
  check("zip_size_matches", parsed.source.zip_size_bytes === zip.length, { actual: zip.length, json: parsed.source.zip_size_bytes });
  check("zip_sha256_matches", parsed.source.zip_sha256 === sha256Buffer(zip));
}

const cjkCount = (jsonText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) || []).length;
const forbiddenFields = (jsonText.match(/"(?:display|interpretation|notes|references|party_ai_enabled|game_time_hours|party_reputation)"\s*:/gu) || []).length;
check("no_cjk_characters", cjkCount === 0, { count: cjkCount });
check("no_mapped_or_interpretive_fields", forbiddenFields === 0, { count: forbiddenFields });

const gh = parsed.game_header;
check("game_signature_matches", gh.signature === fixedString(gam, 0, 4));
check("game_version_matches", gh.version === fixedString(gam, 4, 4));
check("game_header_raw_bytes_match", equalBytes(from64(gh.raw_base64), gam.subarray(0, 0xb4)));

const gameScalarChecks = [
  ["game_time_raw", 0x08, "u32"],
  ["selected_formation_raw", 0x0c, "u16"],
  ["party_gold_raw", 0x18, "u32"],
  ["active_area_party_member_index_raw_uint16", 0x1c, "u16"],
  ["active_area_party_member_index_raw_int16", 0x1c, "i16"],
  ["weather_flags_raw", 0x1e, "u16"],
  ["party_members_offset_raw", 0x20, "u32"],
  ["party_members_count_raw", 0x24, "u32"],
  ["party_inventory_offset_raw", 0x28, "u32"],
  ["party_inventory_count_raw", 0x2c, "u32"],
  ["non_party_members_offset_raw", 0x30, "u32"],
  ["non_party_members_count_raw", 0x34, "u32"],
  ["global_variables_offset_raw", 0x38, "u32"],
  ["global_variables_count_raw", 0x3c, "u32"],
  ["familiar_extra_offset_raw", 0x48, "u32"],
  ["journal_entries_count_raw", 0x4c, "u32"],
  ["journal_entries_offset_raw", 0x50, "u32"],
  ["party_reputation_raw", 0x54, "u32"],
  ["gui_flags_raw", 0x60, "u32"],
  ["loading_progress_raw", 0x64, "u32"],
  ["familiar_info_offset_raw", 0x68, "u32"],
  ["stored_locations_offset_raw", 0x6c, "u32"],
  ["stored_locations_count_raw", 0x70, "u32"],
  ["real_game_time_seconds_raw", 0x74, "u32"],
  ["pocket_plane_locations_offset_raw", 0x78, "u32"],
  ["pocket_plane_locations_count_raw", 0x7c, "u32"],
  ["zoom_level_raw", 0x80, "u32"],
  ["familiar_owner_raw", 0x9c, "u32"],
];
for (const [field, offset, kind] of gameScalarChecks) {
  const actual = kind === "u16" ? u16(offset) : kind === "i16" ? i16(offset) : u32(offset);
  check(`game_header_${field}_matches`, gh[field] === actual, { actual, json: gh[field] });
}
check("formation_buttons_match", jsonEqual(gh.formation_buttons_raw, Array.from({ length: 5 }, (_, i) => u16(0x0e + i * 2))));

const gameStringChecks = [
  ["main_area_resref", 0x40, 8],
  ["current_area_resref", 0x58, 8],
  ["random_encounter_area_resref", 0x84, 8],
  ["current_worldmap_resref", 0x8c, 8],
  ["current_campaign", 0x94, 8],
  ["random_encounter_entry", 0xa0, 20],
];
for (const [field, offset, length] of gameStringChecks) {
  check(`game_header_${field}_matches`, gh[field] === fixedString(gam, offset, length));
}

const partyOffset = u32(0x20);
const partyCount = u32(0x24);
check("party_member_count_matches", parsed.party_members.length === partyCount, { actual: partyCount, json: parsed.party_members.length });

let totalKnownSpells = 0;
let totalMemorizedSpells = 0;
let totalItems = 0;
let totalEffects = 0;

for (let index = 0; index < partyCount; index += 1) {
  const member = parsed.party_members[index];
  const npcOffset = partyOffset + index * 0x160;
  const prefix = `member_${index}`;
  check(`${prefix}_source_index_matches`, member.source_index === index);
  check(`${prefix}_npc_offset_matches`, member.file_offset === npcOffset);
  check(`${prefix}_npc_record_size_matches`, member.record_size === 0x160);
  check(`${prefix}_npc_raw_bytes_match`, equalBytes(from64(member.raw_base64), gam.subarray(npcOffset, npcOffset + 0x160)));

  const nr = member.npc_record;
  const npcScalarChecks = [
    ["selected_state_raw", 0x00, "u16"],
    ["party_order_raw", 0x02, "u16"],
    ["cre_offset_raw", 0x04, "u32"],
    ["cre_size_raw", 0x08, "u32"],
    ["orientation_raw", 0x14, "u32"],
    ["x_coordinate_raw", 0x20, "u16"],
    ["y_coordinate_raw", 0x22, "u16"],
    ["viewing_rectangle_x_raw", 0x24, "u16"],
    ["viewing_rectangle_y_raw", 0x26, "u16"],
    ["modal_action_raw", 0x28, "u16"],
    ["happiness_raw_uint16", 0x2a, "u16"],
    ["happiness_raw_int16", 0x2a, "i16"],
    ["talk_count_raw", 0xe0, "u32"],
  ];
  for (const [field, relativeOffset, kind] of npcScalarChecks) {
    const o = npcOffset + relativeOffset;
    const actual = kind === "u16" ? u16(o) : kind === "i16" ? i16(o) : u32(o);
    check(`${prefix}_npc_${field}_matches`, nr[field] === actual, { actual, json: nr[field] });
  }
  check(`${prefix}_npc_character_resref_matches`, nr.character_resref === fixedString(gam, npcOffset + 0x0c, 8));
  check(`${prefix}_npc_area_resref_matches`, nr.current_area_resref === fixedString(gam, npcOffset + 0x18, 8));
  check(`${prefix}_npc_name_matches`, nr.name === fixedString(gam, npcOffset + 0xc0, 32));
  check(`${prefix}_npc_name_hex_matches`, nr.name_raw_hex === gam.subarray(npcOffset + 0xc0, npcOffset + 0xe0).toString("hex"));
  check(`${prefix}_npc_voice_set_matches`, nr.voice_set === fixedString(gam, npcOffset + 0x158, 8));
  check(`${prefix}_npc_interaction_counts_match`, jsonEqual(nr.interaction_counts_raw, Array.from({ length: 24 }, (_, i) => u32(npcOffset + 0x2c + i * 4))));
  check(`${prefix}_npc_quick_weapons_match`, jsonEqual(nr.quick_weapon_slot_ids_raw, Array.from({ length: 4 }, (_, i) => u16(npcOffset + 0x8c + i * 2))));
  check(`${prefix}_npc_quick_weapon_abilities_match`, jsonEqual(nr.quick_weapon_abilities_raw, Array.from({ length: 4 }, (_, i) => u16(npcOffset + 0x94 + i * 2))));
  check(`${prefix}_npc_quick_spells_match`, jsonEqual(nr.quick_spell_resrefs, Array.from({ length: 3 }, (_, i) => fixedString(gam, npcOffset + 0x9c + i * 8, 8))));
  check(`${prefix}_npc_quick_items_match`, jsonEqual(nr.quick_item_slot_ids_raw, Array.from({ length: 3 }, (_, i) => u16(npcOffset + 0xb4 + i * 2))));
  check(`${prefix}_npc_quick_item_abilities_match`, jsonEqual(nr.quick_item_abilities_raw, Array.from({ length: 3 }, (_, i) => u16(npcOffset + 0xba + i * 2))));

  const statsOffset = npcOffset + 0xe4;
  const stats = nr.character_stats;
  check(`${prefix}_npc_stats_raw_bytes_match`, equalBytes(from64(stats.raw_base64), gam.subarray(statsOffset, statsOffset + 0x74)));
  check(`${prefix}_npc_stats_scalar_fields_match`, jsonEqual([
    stats.most_powerful_vanquished_strref,
    stats.most_powerful_vanquished_xp,
    stats.time_in_party_raw,
    stats.time_joined_raw,
    stats.party_member_raw,
    stats.unused_0x11_raw_hex,
    stats.cre_resref_first_byte_raw,
    stats.chapter_kill_xp,
    stats.chapter_kill_count,
    stats.game_kill_xp,
    stats.game_kill_count,
  ], [
    u32(statsOffset),
    u32(statsOffset + 0x04),
    u32(statsOffset + 0x08),
    u32(statsOffset + 0x0c),
    u8(statsOffset + 0x10),
    gam.subarray(statsOffset + 0x11, statsOffset + 0x13).toString("hex"),
    u8(statsOffset + 0x13),
    u32(statsOffset + 0x14),
    u32(statsOffset + 0x18),
    u32(statsOffset + 0x1c),
    u32(statsOffset + 0x20),
  ]));
  check(`${prefix}_npc_stats_favorite_spells_match`, jsonEqual(stats.favorite_spell_resrefs, Array.from({ length: 4 }, (_, i) => fixedString(gam, statsOffset + 0x24 + i * 8, 8))));
  check(`${prefix}_npc_stats_favorite_spell_counts_match`, jsonEqual(stats.favorite_spell_counts, Array.from({ length: 4 }, (_, i) => u16(statsOffset + 0x44 + i * 2))));
  check(`${prefix}_npc_stats_favorite_weapons_match`, jsonEqual(stats.favorite_weapon_resrefs, Array.from({ length: 4 }, (_, i) => fixedString(gam, statsOffset + 0x4c + i * 8, 8))));
  check(`${prefix}_npc_stats_favorite_weapon_times_match`, jsonEqual(stats.favorite_weapon_times_raw, Array.from({ length: 4 }, (_, i) => u16(statsOffset + 0x6c + i * 2))));

  const creOffset = u32(npcOffset + 0x04);
  const creSize = u32(npcOffset + 0x08);
  const cre = member.embedded_cre_record;
  check(`${prefix}_cre_offset_matches`, cre.file_offset === creOffset);
  check(`${prefix}_cre_size_matches`, cre.size_raw === creSize);
  check(`${prefix}_cre_within_gam_bounds`, creOffset >= 0 && creOffset + creSize <= gam.length, { creOffset, creSize, gamSize: gam.length });
  check(`${prefix}_cre_raw_bytes_match`, equalBytes(from64(cre.raw_base64), gam.subarray(creOffset, creOffset + creSize)));
  check(`${prefix}_cre_header_raw_bytes_match`, equalBytes(from64(cre.header.raw_base64), gam.subarray(creOffset, creOffset + 0x2d4)));
  check(`${prefix}_cre_signature_matches`, cre.header.signature === fixedString(gam, creOffset, 4));
  check(`${prefix}_cre_version_matches`, cre.header.version === fixedString(gam, creOffset + 4, 4));

  const h = cre.header;
  const creHeaderScalarChecks = [
    ["long_name_strref", 0x08, "u32"],
    ["short_name_strref", 0x0c, "u32"],
    ["creature_flags_raw", 0x10, "u32"],
    ["xp_reward_raw", 0x14, "u32"],
    ["experience_raw", 0x18, "u32"],
    ["gold_carried_raw", 0x1c, "u32"],
    ["permanent_status_flags_raw", 0x20, "u32"],
    ["current_hp_raw", 0x24, "i16"],
    ["maximum_hp_raw", 0x26, "i16"],
    ["animation_id_raw", 0x28, "u32"],
    ["effect_version_raw", 0x33, "u8"],
    ["reputation_raw", 0x44, "u8"],
    ["hide_in_shadows_raw", 0x45, "u8"],
    ["armor_class_natural_raw", 0x46, "i16"],
    ["armor_class_effective_raw", 0x48, "i16"],
    ["armor_class_crushing_modifier_raw", 0x4a, "i16"],
    ["armor_class_missile_modifier_raw", 0x4c, "i16"],
    ["armor_class_piercing_modifier_raw", 0x4e, "i16"],
    ["armor_class_slashing_modifier_raw", 0x50, "i16"],
    ["thac0_raw", 0x52, "u8"],
    ["attacks_raw", 0x53, "u8"],
    ["fatigue_raw", 0x6b, "u8"],
    ["intoxication_raw", 0x6c, "u8"],
    ["luck_raw", 0x6d, "i8"],
    ["turn_undead_level_raw", 0x82, "u8"],
    ["tracking_skill_raw", 0x83, "u8"],
    ["attribute_flags_raw", 0x96, "u32"],
    ["sex_raw", 0x237, "u8"],
    ["strength_raw", 0x238, "u8"],
    ["exceptional_strength_raw", 0x239, "u8"],
    ["intelligence_raw", 0x23a, "u8"],
    ["wisdom_raw", 0x23b, "u8"],
    ["dexterity_raw", 0x23c, "u8"],
    ["constitution_raw", 0x23d, "u8"],
    ["charisma_raw", 0x23e, "u8"],
    ["morale_raw", 0x23f, "u8"],
    ["morale_break_raw", 0x240, "u8"],
    ["racial_enemy_raw", 0x241, "u8"],
    ["morale_recovery_time_raw", 0x242, "u16"],
    ["kit_raw", 0x244, "u32"],
    ["global_actor_enumeration_raw", 0x27c, "u16"],
    ["local_actor_enumeration_raw", 0x27e, "u16"],
  ];
  for (const [field, relativeOffset, kind] of creHeaderScalarChecks) {
    const o = creOffset + relativeOffset;
    const actual = kind === "u8" ? u8(o)
      : kind === "i8" ? i8(o)
        : kind === "u16" ? u16(o)
          : kind === "i16" ? i16(o)
            : u32(o);
    check(`${prefix}_cre_header_${field}_matches`, h[field] === actual, { actual, json: h[field] });
  }
  check(`${prefix}_cre_color_indices_match`, jsonEqual(h.color_indices_raw, Array.from({ length: 7 }, (_, i) => u8(creOffset + 0x2c + i))));
  check(`${prefix}_cre_portrait_resrefs_match`, jsonEqual(
    [h.small_portrait_resref, h.large_portrait_resref],
    [fixedString(gam, creOffset + 0x34, 8), fixedString(gam, creOffset + 0x3c, 8)],
  ));
  check(`${prefix}_cre_saving_throws_match`, jsonEqual(Object.values(h.saving_throws_raw), Array.from({ length: 5 }, (_, i) => u8(creOffset + 0x54 + i))));
  check(`${prefix}_cre_resistances_match`, jsonEqual(Object.values(h.resistances_raw), Array.from({ length: 11 }, (_, i) => u8(creOffset + 0x59 + i))));
  check(`${prefix}_cre_skills_match`, jsonEqual(Object.values(h.skills_raw), Array.from({ length: 7 }, (_, i) => u8(creOffset + 0x64 + i))));
  check(`${prefix}_cre_proficiency_bytes_match`, h.proficiency_and_unused_bytes_raw_hex === gam.subarray(creOffset + 0x6e, creOffset + 0x82).toString("hex"));
  check(`${prefix}_cre_tracking_target_bytes_match`, h.tracking_target_raw_hex === gam.subarray(creOffset + 0x84, creOffset + 0xa4).toString("hex"));
  check(`${prefix}_cre_sound_strrefs_match`, jsonEqual(h.sound_strrefs_raw, Array.from({ length: 100 }, (_, i) => u32(creOffset + 0xa4 + i * 4))));
  check(`${prefix}_cre_levels_match`, jsonEqual(h.levels_raw, Array.from({ length: 3 }, (_, i) => u8(creOffset + 0x234 + i))));
  check(`${prefix}_cre_script_resrefs_match`, jsonEqual(Object.values(h.script_resrefs), [0x248, 0x250, 0x258, 0x260, 0x268].map((o) => fixedString(gam, creOffset + o, 8))));
  check(`${prefix}_cre_object_ids_match`, jsonEqual([
    h.object_ids_raw.enemy_ally,
    h.object_ids_raw.general,
    h.object_ids_raw.race,
    h.object_ids_raw.class,
    h.object_ids_raw.specific,
    h.object_ids_raw.gender,
    h.object_ids_raw.object_ids_0x276_raw_hex,
    h.object_ids_raw.alignment,
  ], [
    u8(creOffset + 0x270),
    u8(creOffset + 0x271),
    u8(creOffset + 0x272),
    u8(creOffset + 0x273),
    u8(creOffset + 0x274),
    u8(creOffset + 0x275),
    gam.subarray(creOffset + 0x276, creOffset + 0x27b).toString("hex"),
    u8(creOffset + 0x27b),
  ]));
  check(`${prefix}_cre_death_variable_matches`, h.death_variable === fixedString(gam, creOffset + 0x280, 32));
  check(`${prefix}_cre_dialog_resref_matches`, h.dialog_resref === fixedString(gam, creOffset + 0x2cc, 8));
  const knownOffset = u32(creOffset + 0x2a0);
  const knownCount = u32(creOffset + 0x2a4);
  const infoOffset = u32(creOffset + 0x2a8);
  const infoCount = u32(creOffset + 0x2ac);
  const memorizedOffset = u32(creOffset + 0x2b0);
  const memorizedCount = u32(creOffset + 0x2b4);
  const itemSlotsOffset = u32(creOffset + 0x2b8);
  const itemsOffset = u32(creOffset + 0x2bc);
  const itemsCount = u32(creOffset + 0x2c0);
  const effectsOffset = u32(creOffset + 0x2c4);
  const effectsCount = u32(creOffset + 0x2c8);
  const effectVersion = u8(creOffset + 0x33);
  const effectRecordSize = effectVersion === 1 ? 0x108 : 0x30;

  check(`${prefix}_cre_section_pointer_fields_match`, jsonEqual([
    h.known_spells_offset_raw, h.known_spells_count_raw,
    h.spell_memorization_info_offset_raw, h.spell_memorization_info_count_raw,
    h.memorized_spells_offset_raw, h.memorized_spells_count_raw,
    h.item_slots_offset_raw, h.items_offset_raw, h.items_count_raw,
    h.effects_offset_raw, h.effects_count_raw,
  ], [
    knownOffset, knownCount, infoOffset, infoCount, memorizedOffset, memorizedCount,
    itemSlotsOffset, itemsOffset, itemsCount, effectsOffset, effectsCount,
  ]));

  const sectionEnds = {
    known_spells: knownOffset + knownCount * 12,
    spell_memorization_info: infoOffset + infoCount * 16,
    memorized_spells: memorizedOffset + memorizedCount * 12,
    item_slots: itemSlotsOffset + 40 * 2,
    items: itemsOffset + itemsCount * 20,
    effects: effectsOffset + effectsCount * effectRecordSize,
  };
  for (const [section, end] of Object.entries(sectionEnds)) {
    check(`${prefix}_cre_${section}_within_bounds`, end <= creSize, { end, creSize });
  }

  check(`${prefix}_known_spell_count_matches`, cre.known_spells.length === knownCount);
  for (let i = 0; i < knownCount; i += 1) {
    const o = creOffset + knownOffset + i * 12;
    const entry = cre.known_spells[i];
    check(`${prefix}_known_spell_${i}_raw_bytes_match`, equalBytes(from64(entry.raw_base64), gam.subarray(o, o + 12)));
    check(`${prefix}_known_spell_${i}_fields_match`, jsonEqual([entry.resref, entry.level_raw, entry.type_raw], [fixedString(gam, o, 8), u16(o + 8), u16(o + 10)]));
  }

  check(`${prefix}_spell_info_count_matches`, cre.spell_memorization_info.length === infoCount);
  for (let i = 0; i < infoCount; i += 1) {
    const o = creOffset + infoOffset + i * 16;
    const entry = cre.spell_memorization_info[i];
    check(`${prefix}_spell_info_${i}_raw_bytes_match`, equalBytes(from64(entry.raw_base64), gam.subarray(o, o + 16)));
    check(`${prefix}_spell_info_${i}_fields_match`, jsonEqual([
      entry.level_raw, entry.maximum_memorizable_raw, entry.maximum_memorizable_after_effects_raw,
      entry.type_raw, entry.first_memorized_spell_index_raw, entry.memorized_spell_entry_count_raw,
    ], [u16(o), u16(o + 2), u16(o + 4), u16(o + 6), u32(o + 8), u32(o + 12)]));
  }

  check(`${prefix}_memorized_spell_count_matches`, cre.memorized_spells.length === memorizedCount);
  for (let i = 0; i < memorizedCount; i += 1) {
    const o = creOffset + memorizedOffset + i * 12;
    const entry = cre.memorized_spells[i];
    check(`${prefix}_memorized_spell_${i}_raw_bytes_match`, equalBytes(from64(entry.raw_base64), gam.subarray(o, o + 12)));
    check(`${prefix}_memorized_spell_${i}_fields_match`, jsonEqual([entry.resref, entry.flags_raw], [fixedString(gam, o, 8), u32(o + 8)]));
  }

  check(`${prefix}_item_slot_count_matches`, cre.item_slots.length === 40);
  check(`${prefix}_item_slot_values_match`, jsonEqual(cre.item_slots.map((x) => x.value_raw), Array.from({ length: 40 }, (_, i) => u16(creOffset + itemSlotsOffset + i * 2))));
  check(`${prefix}_item_count_matches`, cre.items.length === itemsCount);
  for (let i = 0; i < itemsCount; i += 1) {
    const o = creOffset + itemsOffset + i * 20;
    const entry = cre.items[i];
    check(`${prefix}_item_${i}_raw_bytes_match`, equalBytes(from64(entry.raw_base64), gam.subarray(o, o + 20)));
    check(`${prefix}_item_${i}_fields_match`, jsonEqual([
      entry.resref, entry.expiration_raw, entry.charge_1_or_quantity_raw,
      entry.charge_2_raw, entry.charge_3_raw, entry.flags_raw,
    ], [fixedString(gam, o, 8), u16(o + 8), u16(o + 10), u16(o + 12), u16(o + 14), u32(o + 16)]));
  }

  check(`${prefix}_effect_version_matches`, cre.effects.effect_version_raw === effectVersion);
  check(`${prefix}_effect_count_matches`, cre.effects.records.length === (effectVersion === 1 ? effectsCount : 0));
  if (effectVersion === 1) {
    for (let i = 0; i < effectsCount; i += 1) {
      const o = creOffset + effectsOffset + i * 0x108;
      const entry = cre.effects.records[i];
      check(`${prefix}_effect_${i}_raw_bytes_match`, equalBytes(from64(entry.raw_base64), gam.subarray(o, o + 0x108)));
      check(`${prefix}_effect_${i}_fields_match`, jsonEqual([
        entry.opcode_raw, entry.target_raw, entry.power_raw,
        entry.parameter_1_raw_uint32, entry.parameter_1_raw_int32,
        entry.parameter_2_raw, entry.timing_mode_raw, entry.duration_raw,
        entry.probability_1_raw, entry.probability_2_raw,
        entry.resource_resref, entry.special_raw, entry.time_applied_raw,
        entry.parent_resource_type_raw, entry.parent_resource_resref, entry.variable_name,
      ], [
        u32(o + 0x08), u32(o + 0x0c), u32(o + 0x10),
        u32(o + 0x14), i32(o + 0x14), u32(o + 0x18), u16(o + 0x1c), u32(o + 0x20),
        u16(o + 0x24), u16(o + 0x26), fixedString(gam, o + 0x28, 8), u32(o + 0x40), u32(o + 0x64),
        u32(o + 0x88), fixedString(gam, o + 0x8c, 8), fixedString(gam, o + 0xa0, 32),
      ]));
    }
  }

  totalKnownSpells += knownCount;
  totalMemorizedSpells += memorizedCount;
  totalItems += itemsCount;
  totalEffects += effectsCount;
}

const failures = checks.filter((entry) => !entry.passed);
const result = {
  valid: failures.length === 0,
  checks_total: checks.length,
  checks_passed: checks.length - failures.length,
  checks_failed: failures.length,
  failures,
  counts: {
    party_members: partyCount,
    known_spells: totalKnownSpells,
    memorized_spells: totalMemorizedSpells,
    items: totalItems,
    effects: totalEffects,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
