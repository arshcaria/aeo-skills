import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const sourceZipPath = process.argv[4] || null;

if (!inputPath || !outputPath) {
  throw new Error("Usage: node export_bgee_raw_json.mjs <BALDUR.gam> <output.json> [source.zip]");
}

const data = await fs.readFile(inputPath);
const u8 = (o) => data.readUInt8(o);
const i8 = (o) => data.readInt8(o);
const u16 = (o) => data.readUInt16LE(o);
const i16 = (o) => data.readInt16LE(o);
const u32 = (o) => data.readUInt32LE(o);
const i32 = (o) => data.readInt32LE(o);
const f64 = (o) => data.readDoubleLE(o);
const bytes = (o, n) => data.subarray(o, o + n);
const base64 = (o, n) => bytes(o, n).toString("base64");
const hex = (o, n) => bytes(o, n).toString("hex");

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
function fixedString(o, n) {
  const raw = bytes(o, n);
  const end = raw.indexOf(0);
  const value = end >= 0 ? raw.subarray(0, end) : raw;
  try {
    return utf8Decoder.decode(value);
  } catch {
    return value.toString("latin1");
  }
}

async function sha256(filePath) {
  const file = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(file).digest("hex");
}

function parseNpcStats(o) {
  return {
    most_powerful_vanquished_strref: u32(o),
    most_powerful_vanquished_xp: u32(o + 0x04),
    time_in_party_raw: u32(o + 0x08),
    time_joined_raw: u32(o + 0x0c),
    party_member_raw: u8(o + 0x10),
    unused_0x11_raw_hex: hex(o + 0x11, 2),
    cre_resref_first_byte_raw: u8(o + 0x13),
    chapter_kill_xp: u32(o + 0x14),
    chapter_kill_count: u32(o + 0x18),
    game_kill_xp: u32(o + 0x1c),
    game_kill_count: u32(o + 0x20),
    favorite_spell_resrefs: Array.from({ length: 4 }, (_, i) => fixedString(o + 0x24 + i * 8, 8)),
    favorite_spell_counts: Array.from({ length: 4 }, (_, i) => u16(o + 0x44 + i * 2)),
    favorite_weapon_resrefs: Array.from({ length: 4 }, (_, i) => fixedString(o + 0x4c + i * 8, 8)),
    favorite_weapon_times_raw: Array.from({ length: 4 }, (_, i) => u16(o + 0x6c + i * 2)),
    raw_base64: base64(o, 0x74),
  };
}

function parseEffects(creOffset, effectsOffset, effectsCount, effectVersion) {
  if (effectVersion !== 1) {
    return {
      effect_version_raw: effectVersion,
      records: [],
    };
  }

  const records = [];
  for (let i = 0; i < effectsCount; i += 1) {
    const o = creOffset + effectsOffset + i * 0x108;
    records.push({
      index: i,
      file_offset: o,
      opcode_raw: u32(o + 0x08),
      target_raw: u32(o + 0x0c),
      power_raw: u32(o + 0x10),
      parameter_1_raw_uint32: u32(o + 0x14),
      parameter_1_raw_int32: i32(o + 0x14),
      parameter_2_raw: u32(o + 0x18),
      timing_mode_raw: u16(o + 0x1c),
      duration_raw: u32(o + 0x20),
      probability_1_raw: u16(o + 0x24),
      probability_2_raw: u16(o + 0x26),
      resource_resref: fixedString(o + 0x28, 8),
      special_raw: u32(o + 0x40),
      time_applied_raw: u32(o + 0x64),
      parent_resource_type_raw: u32(o + 0x88),
      parent_resource_resref: fixedString(o + 0x8c, 8),
      variable_name: fixedString(o + 0xa0, 32),
      raw_base64: base64(o, 0x108),
    });
  }
  return {
    effect_version_raw: effectVersion,
    records,
  };
}

function parseCre(creOffset, creSize) {
  const knownSpellsOffset = u32(creOffset + 0x2a0);
  const knownSpellsCount = u32(creOffset + 0x2a4);
  const spellInfoOffset = u32(creOffset + 0x2a8);
  const spellInfoCount = u32(creOffset + 0x2ac);
  const memorizedSpellsOffset = u32(creOffset + 0x2b0);
  const memorizedSpellsCount = u32(creOffset + 0x2b4);
  const itemSlotsOffset = u32(creOffset + 0x2b8);
  const itemsOffset = u32(creOffset + 0x2bc);
  const itemsCount = u32(creOffset + 0x2c0);
  const effectsOffset = u32(creOffset + 0x2c4);
  const effectsCount = u32(creOffset + 0x2c8);
  const effectVersion = u8(creOffset + 0x33);

  const knownSpells = Array.from({ length: knownSpellsCount }, (_, index) => {
    const o = creOffset + knownSpellsOffset + index * 12;
    return {
      index,
      file_offset: o,
      resref: fixedString(o, 8),
      level_raw: u16(o + 8),
      type_raw: u16(o + 10),
      raw_base64: base64(o, 12),
    };
  });

  const spell_memorization_info = Array.from({ length: spellInfoCount }, (_, index) => {
    const o = creOffset + spellInfoOffset + index * 16;
    return {
      index,
      file_offset: o,
      level_raw: u16(o),
      maximum_memorizable_raw: u16(o + 2),
      maximum_memorizable_after_effects_raw: u16(o + 4),
      type_raw: u16(o + 6),
      first_memorized_spell_index_raw: u32(o + 8),
      memorized_spell_entry_count_raw: u32(o + 12),
      raw_base64: base64(o, 16),
    };
  });

  const memorizedSpells = Array.from({ length: memorizedSpellsCount }, (_, index) => {
    const o = creOffset + memorizedSpellsOffset + index * 12;
    return {
      index,
      file_offset: o,
      resref: fixedString(o, 8),
      flags_raw: u32(o + 8),
      raw_base64: base64(o, 12),
    };
  });

  const itemSlots = Array.from({ length: 40 }, (_, index) => ({
    index,
    value_raw: u16(creOffset + itemSlotsOffset + index * 2),
  }));

  const items = Array.from({ length: itemsCount }, (_, index) => {
    const o = creOffset + itemsOffset + index * 20;
    return {
      index,
      file_offset: o,
      resref: fixedString(o, 8),
      expiration_raw: u16(o + 8),
      charge_1_or_quantity_raw: u16(o + 10),
      charge_2_raw: u16(o + 12),
      charge_3_raw: u16(o + 14),
      flags_raw: u32(o + 16),
      raw_base64: base64(o, 20),
    };
  });

  const header = {
    signature: fixedString(creOffset, 4),
    version: fixedString(creOffset + 4, 4),
    long_name_strref: u32(creOffset + 0x08),
    short_name_strref: u32(creOffset + 0x0c),
    creature_flags_raw: u32(creOffset + 0x10),
    xp_reward_raw: u32(creOffset + 0x14),
    experience_raw: u32(creOffset + 0x18),
    gold_carried_raw: u32(creOffset + 0x1c),
    permanent_status_flags_raw: u32(creOffset + 0x20),
    current_hp_raw: i16(creOffset + 0x24),
    maximum_hp_raw: i16(creOffset + 0x26),
    animation_id_raw: u32(creOffset + 0x28),
    color_indices_raw: Array.from({ length: 7 }, (_, i) => u8(creOffset + 0x2c + i)),
    effect_version_raw: effectVersion,
    small_portrait_resref: fixedString(creOffset + 0x34, 8),
    large_portrait_resref: fixedString(creOffset + 0x3c, 8),
    reputation_raw: u8(creOffset + 0x44),
    hide_in_shadows_raw: u8(creOffset + 0x45),
    armor_class_natural_raw: i16(creOffset + 0x46),
    armor_class_effective_raw: i16(creOffset + 0x48),
    armor_class_crushing_modifier_raw: i16(creOffset + 0x4a),
    armor_class_missile_modifier_raw: i16(creOffset + 0x4c),
    armor_class_piercing_modifier_raw: i16(creOffset + 0x4e),
    armor_class_slashing_modifier_raw: i16(creOffset + 0x50),
    thac0_raw: u8(creOffset + 0x52),
    attacks_raw: u8(creOffset + 0x53),
    saving_throws_raw: {
      death: u8(creOffset + 0x54),
      wands: u8(creOffset + 0x55),
      polymorph: u8(creOffset + 0x56),
      breath: u8(creOffset + 0x57),
      spells: u8(creOffset + 0x58),
    },
    resistances_raw: {
      fire: u8(creOffset + 0x59),
      cold: u8(creOffset + 0x5a),
      electricity: u8(creOffset + 0x5b),
      acid: u8(creOffset + 0x5c),
      magic: u8(creOffset + 0x5d),
      magic_fire: u8(creOffset + 0x5e),
      magic_cold: u8(creOffset + 0x5f),
      slashing: u8(creOffset + 0x60),
      crushing: u8(creOffset + 0x61),
      piercing: u8(creOffset + 0x62),
      missile: u8(creOffset + 0x63),
    },
    skills_raw: {
      detect_illusion: u8(creOffset + 0x64),
      set_traps: u8(creOffset + 0x65),
      lore: u8(creOffset + 0x66),
      open_locks: u8(creOffset + 0x67),
      move_silently: u8(creOffset + 0x68),
      find_disarm_traps: u8(creOffset + 0x69),
      pick_pockets: u8(creOffset + 0x6a),
    },
    fatigue_raw: u8(creOffset + 0x6b),
    intoxication_raw: u8(creOffset + 0x6c),
    luck_raw: i8(creOffset + 0x6d),
    proficiency_and_unused_bytes_raw_hex: hex(creOffset + 0x6e, 0x14),
    turn_undead_level_raw: u8(creOffset + 0x82),
    tracking_skill_raw: u8(creOffset + 0x83),
    tracking_target_raw_hex: hex(creOffset + 0x84, 32),
    attribute_flags_raw: u32(creOffset + 0x96),
    sound_strrefs_raw: Array.from({ length: 100 }, (_, i) => u32(creOffset + 0xa4 + i * 4)),
    levels_raw: [u8(creOffset + 0x234), u8(creOffset + 0x235), u8(creOffset + 0x236)],
    sex_raw: u8(creOffset + 0x237),
    strength_raw: u8(creOffset + 0x238),
    exceptional_strength_raw: u8(creOffset + 0x239),
    intelligence_raw: u8(creOffset + 0x23a),
    wisdom_raw: u8(creOffset + 0x23b),
    dexterity_raw: u8(creOffset + 0x23c),
    constitution_raw: u8(creOffset + 0x23d),
    charisma_raw: u8(creOffset + 0x23e),
    morale_raw: u8(creOffset + 0x23f),
    morale_break_raw: u8(creOffset + 0x240),
    racial_enemy_raw: u8(creOffset + 0x241),
    morale_recovery_time_raw: u16(creOffset + 0x242),
    kit_raw: u32(creOffset + 0x244),
    script_resrefs: {
      override: fixedString(creOffset + 0x248, 8),
      class: fixedString(creOffset + 0x250, 8),
      race: fixedString(creOffset + 0x258, 8),
      general: fixedString(creOffset + 0x260, 8),
      default: fixedString(creOffset + 0x268, 8),
    },
    object_ids_raw: {
      enemy_ally: u8(creOffset + 0x270),
      general: u8(creOffset + 0x271),
      race: u8(creOffset + 0x272),
      class: u8(creOffset + 0x273),
      specific: u8(creOffset + 0x274),
      gender: u8(creOffset + 0x275),
      object_ids_0x276_raw_hex: hex(creOffset + 0x276, 5),
      alignment: u8(creOffset + 0x27b),
    },
    global_actor_enumeration_raw: u16(creOffset + 0x27c),
    local_actor_enumeration_raw: u16(creOffset + 0x27e),
    death_variable: fixedString(creOffset + 0x280, 32),
    known_spells_offset_raw: knownSpellsOffset,
    known_spells_count_raw: knownSpellsCount,
    spell_memorization_info_offset_raw: spellInfoOffset,
    spell_memorization_info_count_raw: spellInfoCount,
    memorized_spells_offset_raw: memorizedSpellsOffset,
    memorized_spells_count_raw: memorizedSpellsCount,
    item_slots_offset_raw: itemSlotsOffset,
    items_offset_raw: itemsOffset,
    items_count_raw: itemsCount,
    effects_offset_raw: effectsOffset,
    effects_count_raw: effectsCount,
    dialog_resref: fixedString(creOffset + 0x2cc, 8),
    raw_base64: base64(creOffset, 0x2d4),
  };

  return {
    file_offset: creOffset,
    size_raw: creSize,
    raw_base64: base64(creOffset, creSize),
    header,
    known_spells: knownSpells,
    spell_memorization_info,
    memorized_spells: memorizedSpells,
    item_slots: itemSlots,
    items,
    effects: parseEffects(creOffset, effectsOffset, effectsCount, effectVersion),
  };
}

function parsePartyMember(npcOffset, sourceIndex) {
  const creOffset = u32(npcOffset + 0x04);
  const creSize = u32(npcOffset + 0x08);
  const record = {
    selected_state_raw: u16(npcOffset),
    party_order_raw: u16(npcOffset + 0x02),
    cre_offset_raw: creOffset,
    cre_size_raw: creSize,
    character_resref: fixedString(npcOffset + 0x0c, 8),
    orientation_raw: u32(npcOffset + 0x14),
    current_area_resref: fixedString(npcOffset + 0x18, 8),
    x_coordinate_raw: u16(npcOffset + 0x20),
    y_coordinate_raw: u16(npcOffset + 0x22),
    viewing_rectangle_x_raw: u16(npcOffset + 0x24),
    viewing_rectangle_y_raw: u16(npcOffset + 0x26),
    modal_action_raw: u16(npcOffset + 0x28),
    happiness_raw_uint16: u16(npcOffset + 0x2a),
    happiness_raw_int16: i16(npcOffset + 0x2a),
    interaction_counts_raw: Array.from({ length: 24 }, (_, i) => u32(npcOffset + 0x2c + i * 4)),
    quick_weapon_slot_ids_raw: Array.from({ length: 4 }, (_, i) => u16(npcOffset + 0x8c + i * 2)),
    quick_weapon_abilities_raw: Array.from({ length: 4 }, (_, i) => u16(npcOffset + 0x94 + i * 2)),
    quick_spell_resrefs: Array.from({ length: 3 }, (_, i) => fixedString(npcOffset + 0x9c + i * 8, 8)),
    quick_item_slot_ids_raw: Array.from({ length: 3 }, (_, i) => u16(npcOffset + 0xb4 + i * 2)),
    quick_item_abilities_raw: Array.from({ length: 3 }, (_, i) => u16(npcOffset + 0xba + i * 2)),
    name: fixedString(npcOffset + 0xc0, 32),
    name_raw_hex: hex(npcOffset + 0xc0, 32),
    talk_count_raw: u32(npcOffset + 0xe0),
    character_stats: parseNpcStats(npcOffset + 0xe4),
    voice_set: fixedString(npcOffset + 0x158, 8),
  };

  return {
    source_index: sourceIndex,
    file_offset: npcOffset,
    record_size: 0x160,
    raw_base64: base64(npcOffset, 0x160),
    npc_record: record,
    embedded_cre_record: parseCre(creOffset, creSize),
  };
}

if (fixedString(0, 4) !== "GAME" || fixedString(4, 4) !== "V2.0") {
  throw new Error("Unsupported GAM signature or version");
}

const partyMembersOffset = u32(0x20);
const partyMembersCount = u32(0x24);
const sourceZipStats = sourceZipPath ? await fs.stat(sourceZipPath) : null;

const output = {
  source: {
    zip_file_name: sourceZipPath ? path.basename(sourceZipPath) : null,
    zip_size_bytes: sourceZipStats?.size ?? null,
    zip_sha256: sourceZipPath ? await sha256(sourceZipPath) : null,
    gam_file_name: path.basename(inputPath),
    gam_size_bytes: data.length,
    gam_sha256: crypto.createHash("sha256").update(data).digest("hex"),
  },
  game_header: {
    signature: fixedString(0, 4),
    version: fixedString(4, 4),
    game_time_raw: u32(0x08),
    selected_formation_raw: u16(0x0c),
    formation_buttons_raw: Array.from({ length: 5 }, (_, i) => u16(0x0e + i * 2)),
    party_gold_raw: u32(0x18),
    active_area_party_member_index_raw_uint16: u16(0x1c),
    active_area_party_member_index_raw_int16: i16(0x1c),
    weather_flags_raw: u16(0x1e),
    party_members_offset_raw: partyMembersOffset,
    party_members_count_raw: partyMembersCount,
    party_inventory_offset_raw: u32(0x28),
    party_inventory_count_raw: u32(0x2c),
    non_party_members_offset_raw: u32(0x30),
    non_party_members_count_raw: u32(0x34),
    global_variables_offset_raw: u32(0x38),
    global_variables_count_raw: u32(0x3c),
    main_area_resref: fixedString(0x40, 8),
    familiar_extra_offset_raw: u32(0x48),
    journal_entries_count_raw: u32(0x4c),
    journal_entries_offset_raw: u32(0x50),
    party_reputation_raw: u32(0x54),
    current_area_resref: fixedString(0x58, 8),
    gui_flags_raw: u32(0x60),
    loading_progress_raw: u32(0x64),
    familiar_info_offset_raw: u32(0x68),
    stored_locations_offset_raw: u32(0x6c),
    stored_locations_count_raw: u32(0x70),
    real_game_time_seconds_raw: u32(0x74),
    pocket_plane_locations_offset_raw: u32(0x78),
    pocket_plane_locations_count_raw: u32(0x7c),
    zoom_level_raw: u32(0x80),
    random_encounter_area_resref: fixedString(0x84, 8),
    current_worldmap_resref: fixedString(0x8c, 8),
    current_campaign: fixedString(0x94, 8),
    familiar_owner_raw: u32(0x9c),
    random_encounter_entry: fixedString(0xa0, 20),
    raw_base64: base64(0, 0xb4),
  },
  party_members: Array.from(
    { length: partyMembersCount },
    (_, index) => parsePartyMember(partyMembersOffset + index * 0x160, index),
  ),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  output_path: outputPath,
  party_members_count: output.party_members.length,
  output_size_bytes: (await fs.stat(outputPath)).size,
}, null, 2));
