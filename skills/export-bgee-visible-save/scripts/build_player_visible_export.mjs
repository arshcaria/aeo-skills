import fs from "node:fs/promises";
import path from "node:path";
import { DialogTLK, parse2da } from "./ie_game_resources.mjs";

const [rawJsonPath, resourcesJsonPath, outputCsvPath, saveDisplayName, areaDisplayName, languageArg] = process.argv.slice(2);
if (!rawJsonPath || !resourcesJsonPath || !outputCsvPath) {
  throw new Error("Usage: node build_player_visible_export.mjs <raw_json> <resources_json> <output_csv> [save_name] [area_name]");
}

const raw = JSON.parse(await fs.readFile(rawJsonPath, "utf8"));
const resources = JSON.parse(await fs.readFile(resourcesJsonPath, "utf8"));
const language = languageArg || resources.language || "en_US";
const tlk = await DialogTLK.open(resources.dialog_tlk_path || path.join(resources.game_directory, "lang", language, "dialog.tlk"));
const tablesDir = path.join(path.dirname(resourcesJsonPath), "2da");

async function load2da(resref) {
  return parse2da(await fs.readFile(path.join(tablesDir, `${resref}.2da`)), resref);
}

const [dexMod, skillDex, skillRac, loreBon, wisSlots, wSpecial, wspAtck, raceThac, kitList] = await Promise.all([
  load2da("DEXMOD"),
  load2da("SKILLDEX"),
  load2da("SKILLRAC"),
  load2da("LOREBON"),
  load2da("MXSPLWIS"),
  load2da("WSPECIAL"),
  load2da("WSPATCK"),
  load2da("RACETHAC"),
  load2da("KITLIST"),
]);

const itemDefinitions = new Map(resources.items.map((item) => [item.resref, item]));
const spellDefinitions = new Map(resources.spells.map((spell) => [spell.resref, spell]));
const containerStores = new Map((raw.container_stores || []).map((store) => [store.resref, store]));
const heldContainerResrefs = new Set(raw.party_members.flatMap((member) => member.embedded_cre_record.items)
  .filter((item) => itemDefinitions.get(item.resref)?.item_type === 36)
  .map((item) => item.resref));
if (heldContainerResrefs.size && !raw.container_source_available) {
  throw new Error("BALDUR.SAV is required to export contents of party-held containers");
}
const missingContainerStores = [...heldContainerResrefs].filter((resref) => !containerStores.has(resref));
if (missingContainerStores.length) {
  throw new Error(`Missing saved store records for party-held containers: ${missingContainerStores.join(", ")}`);
}

const RACES = {
  1: { name: "Human", table: "HUMAN" },
  2: { name: "Elf", table: "ELF" },
  3: { name: "Half-Elf", table: "HALF_ELF" },
  4: { name: "Dwarf", table: "DWARF" },
  5: { name: "Halfling", table: "HALFLING" },
  6: { name: "Gnome", table: "GNOME" },
  7: { name: "Half-Orc", table: "HALFORC" },
};

const ALIGNMENTS = {
  17: "Lawful Good",
  18: "Lawful Neutral",
  19: "Lawful Evil",
  33: "Neutral Good",
  34: "True Neutral",
  35: "Neutral Evil",
  49: "Chaotic Good",
  50: "Chaotic Neutral",
  51: "Chaotic Evil",
};

const GENDERS = { 1: "Male", 2: "Female", 3: "Other", 4: "Neither" };
const PROFICIENCIES = {
  89: "Bastard Sword", 90: "Long Sword", 91: "Short Sword", 92: "Axe",
  93: "Two-Handed Sword", 94: "Katana", 95: "Scimitar/Wakizashi/Ninjato",
  96: "Dagger", 97: "War Hammer", 98: "Spear", 99: "Halberd",
  100: "Flail/Morning Star", 101: "Mace", 102: "Quarterstaff", 103: "Crossbow",
  104: "Longbow", 105: "Shortbow", 106: "Dart", 107: "Sling",
  111: "Two-Handed Weapon Style", 112: "Sword and Shield Style",
  113: "Single-Weapon Style", 114: "Two-Weapon Style", 115: "Club",
};

const SLOT_NAMES = [
  "Helmet", "Armor", "Shield", "Gauntlets", "Left Ring", "Right Ring", "Amulet", "Belt", "Boots",
  "Weapon 1", "Weapon 2", "Weapon 3", "Weapon 4", "Quiver 1", "Quiver 2", "Quiver 3", "Quiver 4",
  "Cloak", "Quick Item 1", "Quick Item 2", "Quick Item 3",
  ...Array.from({ length: 16 }, (_, i) => `Inventory ${i + 1}`),
  "Magic Weapon",
];

const SPELL_TYPES = { 0: "Priest", 1: "Wizard", 2: "Innate" };
const CLASS_COMPONENTS = {
  1: ["Mage"], 2: ["Fighter"], 3: ["Cleric"], 4: ["Thief"], 5: ["Bard"],
  6: ["Paladin"], 7: ["Fighter", "Mage"], 8: ["Fighter", "Cleric"],
  9: ["Fighter", "Thief"], 10: ["Fighter", "Mage", "Thief"], 11: ["Druid"],
  12: ["Ranger"], 13: ["Mage", "Thief"], 14: ["Cleric", "Mage"],
  15: ["Cleric", "Thief"], 16: ["Fighter", "Druid"],
  17: ["Fighter", "Mage", "Cleric"], 18: ["Cleric", "Ranger"],
  19: ["Sorcerer"], 20: ["Monk"], 21: ["Shaman"],
};
const SKILL_COLUMNS = [
  ["pick_pockets", "PICK_POCKETS", "Pick Pockets"],
  ["open_locks", "OPEN_LOCKS", "Open Locks"],
  ["find_disarm_traps", "FIND_TRAPS", "Find/Disarm Traps"],
  ["move_silently", "MOVE_SILENTLY", "Move Silently"],
  ["hide_in_shadows", "HIDE_IN_SHADOWS", "Hide In Shadows"],
  ["detect_illusion", "DETECT_ILLUSION", "Detect Illusion"],
  ["set_traps", "SET_TRAPS", "Set Traps"],
];

function tableRow(table, rowName) {
  const row = table.rows.find((candidate) => candidate.row_name.toUpperCase() === String(rowName).toUpperCase());
  if (!row) throw new Error(`Missing row ${rowName} in ${table.resref}`);
  return row;
}

function tableNumber(table, rowName, columnName) {
  const row = tableRow(table, rowName);
  const value = row.cells[columnName] ?? table.default_value;
  return Number(value);
}

function signedWord(value) {
  return value > 0x7fff ? value - 0x10000 : value;
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFromRows(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function displayName(member) {
  const fromRecord = member.npc_record.name?.trim();
  const fromTlk = tlk.get(member.embedded_cre_record.header.long_name_strref)?.trim();
  if (fromRecord) return fromRecord;
  if (fromTlk && fromTlk !== "<NO TEXT>" && !fromTlk.includes("<CHARNAME>")) return fromTlk;
  return `Party Member ${member.npc_record.party_order_raw}`;
}

function kitDisplayName(kitRaw) {
  if (!kitRaw || kitRaw === 0x40000000) return null;
  const kitId = kitRaw >>> 16;
  const row = kitList.rows.find((candidate) => Number.parseInt(candidate.cells.KITIDS, 16) === kitId);
  const name = row ? tlk.get(Number(row.cells.MIXED))?.trim() : null;
  return name && name !== "<NO TEXT>" ? name : null;
}

function classDisplay(member) {
  const h = member.embedded_cre_record.header;
  const components = CLASS_COMPONENTS[h.object_ids_raw.class];
  if (!components) return "Unknown Class";
  const kit = components.length === 1 ? kitDisplayName(h.kit_raw) : null;
  const labels = components.map((component, index) => `${index === 0 && kit ? kit : component} ${h.levels_raw[index]}`);
  if (h.object_ids_raw.class === 13 && h.levels_raw[0] <= h.levels_raw[1]) labels[1] += " (inactive)";
  return labels.join(" / ");
}

function nonProficiencyPenalty(classId) {
  // BGEE Adventurer's Guide: warrior -2, rogue/priest -3, wizard -5.
  if ([2, 6, 8, 9, 10, 11, 12, 16, 17, 18].includes(classId)) return 2;
  if ([3, 4, 5, 7, 13, 14, 15].includes(classId)) return 3;
  return 5;
}

function partyItem(member, slotIndex) {
  const itemIndex = member.embedded_cre_record.item_slots[slotIndex]?.value_raw;
  if (itemIndex === undefined || itemIndex === 0xffff) return null;
  const instance = member.embedded_cre_record.items[itemIndex];
  const definition = itemDefinitions.get(instance.resref);
  if (!definition) throw new Error(`Missing item definition ${instance.resref}`);
  return { slotIndex, instance, definition };
}

function currentLoadout(member) {
  const selection = signedWord(member.embedded_cre_record.item_slots[38].value_raw) + 35;
  let weaponSlot = null;
  let ammoSlot = null;
  if (selection >= 35 && selection <= 38) {
    weaponSlot = 9 + selection - 35;
  } else if (selection >= 11 && selection <= 14) {
    ammoSlot = 13 + selection - 11;
    for (let slot = 9; slot <= 12; slot += 1) {
      const candidate = partyItem(member, slot);
      if (candidate?.definition.abilities.some((ability) => ability.attack_type === 4)) {
        weaponSlot = slot;
        break;
      }
    }
  }
  const weapon = weaponSlot === null ? null : partyItem(member, weaponSlot);
  const ammo = ammoSlot === null ? null : partyItem(member, ammoSlot);
  const abilityIndex = member.embedded_cre_record.item_slots[39].value_raw;
  const weaponAbility = weapon?.definition.abilities[abilityIndex] ?? weapon?.definition.abilities[0] ?? null;
  const ammoAbility = ammo?.definition.abilities[0] ?? null;
  const ranged = weaponAbility?.attack_type === 2 || weaponAbility?.attack_type === 4 || ammoAbility?.attack_type === 2;
  const twoHanded = Boolean((weapon?.definition.flags_raw ?? 0) & 0x02);
  return { selection, weaponSlot, ammoSlot, weapon, ammo, weaponAbility, ammoAbility, ranged, twoHanded };
}

function passiveItems(member, loadout) {
  const active = [];
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 17]) {
    if (slot === 2 && loadout.twoHanded) continue;
    const item = partyItem(member, slot);
    if (item) active.push(item);
  }
  return active;
}

function activeEffects(passives) {
  return passives.flatMap((item) => item.definition.equipping_effects);
}

function applyAttributeEffects(base, opcode, effects) {
  let value = base;
  for (const effect of effects.filter((candidate) => candidate.opcode === opcode)) {
    if (effect.parameter_2_uint32 === 1) value = effect.parameter_1_int32;
    else if (effect.parameter_2_uint32 === 2) value = Math.trunc(value * effect.parameter_1_int32 / 100);
    else value += effect.parameter_1_int32;
  }
  return value;
}

function proficiencyEntries(member) {
  return member.embedded_cre_record.effects.records
    .filter((effect) => effect.opcode_raw === 233)
    .map((effect) => {
      const packed = effect.parameter_1_raw_uint32;
      const activePips = packed & 0x07;
      const secondaryPips = (packed >>> 3) & 0x07;
      const pips = activePips || secondaryPips;
      return {
        id: effect.parameter_2_raw,
        name: PROFICIENCIES[effect.parameter_2_raw] ?? "Unknown Proficiency",
        pips,
        active: activePips > 0,
      };
    })
    .filter((entry) => entry.pips > 0);
}

function proficiencyPips(member, id, activeOnly = true) {
  const entry = proficiencyEntries(member).find((candidate) => candidate.id === id);
  if (!entry || (activeOnly && !entry.active)) return 0;
  return entry.pips;
}

function strengthBonuses(strength) {
  const hit = strength <= 25 ? tableNumber(awaitedTables.strMod, strength, "TO_HIT") : 0;
  const damage = strength <= 25 ? tableNumber(awaitedTables.strMod, strength, "DAMAGE") : 0;
  return { hit, damage };
}

const awaitedTables = { strMod: await load2da("STRMOD") };

function weaponSpecialization(pips) {
  const rowName = Math.min(5, pips);
  return {
    hit: tableNumber(wSpecial, rowName, "HIT"),
    damage: tableNumber(wSpecial, rowName, "DAMAGE"),
  };
}

function attackIncrement(member, pips) {
  const h = member.embedded_cre_record.header;
  let fighterLevel = 0;
  if ([2, 9, 16].includes(h.object_ids_raw.class)) fighterLevel = h.levels_raw[0];
  if (!fighterLevel) return 0;
  const row = tableRow(wspAtck, Math.min(5, pips));
  const encoded = Number(row.values[Math.max(0, Math.min(row.values.length - 1, fighterLevel - 1))]);
  return encoded >= 0 ? encoded : Math.abs(encoded) - 0.5;
}

function spellSlotMax(member, info, effects, currentWisdom) {
  let maximum = info.maximum_memorizable_raw;
  if (info.type_raw === 0 && currentWisdom >= 13) {
    maximum += tableNumber(wisSlots, currentWisdom, String(info.level_raw + 1));
  }
  if (info.type_raw === 0) {
    for (const effect of effects.filter((candidate) => candidate.opcode === 62)) {
      const level = Math.log2(effect.parameter_2_uint32) + 1;
      if (Number.isInteger(level) && level === info.level_raw + 1) maximum += effect.parameter_1_int32;
    }
  }
  if (info.type_raw === 1) {
    for (const effect of effects.filter((candidate) => candidate.opcode === 42)) {
      if (effect.parameter_2_uint32 === info.level_raw && effect.parameter_1_int32 === 1) maximum *= 2;
    }
  }
  return maximum;
}

const rows = [["Section", "Party Order", "Character", "Category", "Field", "Value", "Detail"]];
function add(section, order, character, category, field, value, detail = "") {
  rows.push([section, order ?? "", character ?? "", category, field, value, detail]);
}

add("TEAM OVERVIEW", "", "", "Party", "Save", saveDisplayName || raw.source.zip_file_name || "Current Save");
add("TEAM OVERVIEW", "", "", "Party", "Campaign", resources.campaign || "Baldur's Gate: Enhanced Edition");
add("TEAM OVERVIEW", "", "", "Party", "Party Members", raw.game_header.party_members_count_raw);
add("TEAM OVERVIEW", "", "", "Party", "Gold", raw.game_header.party_gold_raw);
add("TEAM OVERVIEW", "", "", "Party", "Reputation", raw.game_header.party_reputation_raw / 10);
add("TEAM OVERVIEW", "", "", "Party", "Current Area", areaDisplayName || "Unknown Area");

const derivedMembers = [];
for (const member of [...raw.party_members].sort((a, b) => a.npc_record.party_order_raw - b.npc_record.party_order_raw)) {
  const order = member.npc_record.party_order_raw;
  const name = displayName(member);
  const h = member.embedded_cre_record.header;
  const race = RACES[h.object_ids_raw.race] ?? { name: "Unknown Race", table: "HUMAN" };
  const loadout = currentLoadout(member);
  const passives = passiveItems(member, loadout);
  const effects = activeEffects(passives);
  const strength = applyAttributeEffects(h.strength_raw, 44, effects);
  const dexterity = applyAttributeEffects(h.dexterity_raw, 15, effects);
  const constitution = applyAttributeEffects(h.constitution_raw, 10, effects);
  const intelligence = applyAttributeEffects(h.intelligence_raw, 19, effects);
  const wisdom = applyAttributeEffects(h.wisdom_raw, 49, effects);
  const charisma = applyAttributeEffects(h.charisma_raw, 6, effects);

  const baseAcEffects = effects.filter((effect) => effect.opcode === 0 && effect.parameter_2_uint32 === 16);
  const baseAc = baseAcEffects.length ? Math.min(...baseAcEffects.map((effect) => effect.parameter_1_int32)) : h.armor_class_natural_raw;
  const generalAcBonus = effects.filter((effect) => effect.opcode === 0 && effect.parameter_2_uint32 === 0)
    .reduce((sum, effect) => sum + effect.parameter_1_int32, 0);
  const acModifiers = { crushing: 0, missile: 0, piercing: 0, slashing: 0 };
  const acTypeByParameter = { 1: "crushing", 2: "missile", 4: "piercing", 8: "slashing" };
  for (const effect of effects.filter((candidate) => candidate.opcode === 0 && acTypeByParameter[candidate.parameter_2_uint32])) {
    acModifiers[acTypeByParameter[effect.parameter_2_uint32]] -= effect.parameter_1_int32;
  }
  const swordShieldPips = proficiencyPips(member, 112);
  if (partyItem(member, 2) && !loadout.twoHanded && swordShieldPips > 0) {
    acModifiers.missile += tableNumber(await load2da("STYLBONU"), `SWORDANDSHIELD-${Math.min(2, swordShieldPips)}`, "AC_MISSILE");
  }
  const ac = baseAc + tableNumber(dexMod, dexterity, "AC") - generalAcBonus;

  const saves = { ...h.saving_throws_raw };
  const saveOpcode = { 33: "death", 34: "wands", 35: "polymorph", 36: "breath", 37: "spells" };
  for (const effect of effects.filter((candidate) => saveOpcode[candidate.opcode])) {
    saves[saveOpcode[effect.opcode]] -= effect.parameter_1_int32;
  }

  const resistances = { ...h.resistances_raw };
  const resistanceOpcode = { 27: "acid", 28: "cold", 29: "electricity", 30: "fire", 31: "magic" };
  for (const effect of effects.filter((candidate) => resistanceOpcode[candidate.opcode])) {
    resistances[resistanceOpcode[effect.opcode]] += effect.parameter_1_int32;
  }

  const currentWeaponProf = loadout.weapon?.definition.proficiency_type_raw ?? 0;
  const currentPips = proficiencyPips(member, currentWeaponProf);
  const specialization = weaponSpecialization(currentPips);
  const physicalBonus = loadout.ranged ? tableNumber(dexMod, dexterity, "MISSILE") : strengthBonuses(strength).hit;
  const weaponThacBonus = loadout.weaponAbility?.thac0_bonus ?? 0;
  const ammoThacBonus = loadout.ammoAbility?.thac0_bonus ?? 0;
  const passiveThacBonus = effects.reduce((sum, effect) => {
    if (effect.opcode === 54) return sum + effect.parameter_1_int32;
    if (effect.opcode === 167 && loadout.ranged) return sum + effect.parameter_1_int32;
    return sum;
  }, 0);
  let racialThacBonus = 0;
  if (currentWeaponProf && raceThac.rows.some((row) => Number(row.row_name) === currentWeaponProf)) {
    racialThacBonus = tableNumber(raceThac, currentWeaponProf, race.table);
  }
  const untrainedPenalty = currentWeaponProf && currentPips === 0 ? nonProficiencyPenalty(h.object_ids_raw.class) : 0;
  const thac0 = h.thac0_raw - physicalBonus - weaponThacBonus - ammoThacBonus - passiveThacBonus
    - specialization.hit - racialThacBonus + untrainedPenalty;

  const strengthDamage = loadout.ranged
    ? (loadout.weapon?.definition.item_type === 18 ? strengthBonuses(strength).damage : 0)
    : strengthBonuses(strength).damage;
  const passiveDamage = effects.filter((effect) => effect.opcode === 73).reduce((sum, effect) => sum + effect.parameter_1_int32, 0);
  const damageAbility = loadout.ammoAbility ?? loadout.weaponAbility;
  const diceCount = damageAbility?.dice_thrown ?? 0;
  const diceSides = damageAbility?.dice_sides ?? 0;
  const damageBonus = (loadout.weaponAbility?.damage_bonus ?? 0) + (loadout.ammoAbility?.damage_bonus ?? 0)
    + strengthDamage + specialization.damage + passiveDamage;
  const damageMin = (diceCount || 0) + damageBonus;
  const damageMax = (diceCount && diceSides ? diceCount * diceSides : 0) + damageBonus;
  const baseAttacks = effects
    .concat(loadout.weapon?.definition.equipping_effects ?? [])
    .filter((effect) => effect.opcode === 1 && effect.parameter_2_uint32 === 1)
    .reduce((value, effect) => effect.parameter_1_int32, h.attacks_raw);
  const attacks = baseAttacks + attackIncrement(member, currentPips);
  const attacksDisplay = Number.isInteger(attacks) ? String(attacks) : `${Math.trunc(attacks * 2)}/2`;

  const lore = Math.max(0, h.skills_raw.lore + tableNumber(loreBon, intelligence, "VALUE") + tableNumber(loreBon, wisdom, "VALUE"));
  const skillValues = {};
  const raceSkillRow = tableRow(skillRac, race.table);
  const dexSkillRow = tableRow(skillDex, dexterity);
  for (const [rawKey, column] of SKILL_COLUMNS) {
    const base = rawKey === "hide_in_shadows" ? h.hide_in_shadows_raw : h.skills_raw[rawKey];
    skillValues[rawKey] = base + Number(raceSkillRow.cells[column] ?? 0) + Number(dexSkillRow.cells[column] ?? 0);
  }
  skillValues.move_silently += effects.filter((effect) => effect.opcode === 59).reduce((sum, effect) => sum + effect.parameter_1_int32, 0);
  skillValues.hide_in_shadows += effects.filter((effect) => effect.opcode === 275).reduce((sum, effect) => sum + effect.parameter_1_int32, 0);

  add("MEMBER DETAILS", order, name, "Identity", "Class and Level", classDisplay(member));
  add("MEMBER DETAILS", order, name, "Identity", "Race", race.name);
  add("MEMBER DETAILS", order, name, "Identity", "Gender", GENDERS[h.sex_raw] ?? "Unknown");
  add("MEMBER DETAILS", order, name, "Identity", "Alignment", ALIGNMENTS[h.object_ids_raw.alignment] ?? "Unknown");
  add("MEMBER DETAILS", order, name, "Progress", "Experience", h.experience_raw);
  add("MEMBER DETAILS", order, name, "Vitals", "Hit Points", `${h.current_hp_raw}/${h.maximum_hp_raw}`);
  add("MEMBER DETAILS", order, name, "Combat", "Armor Class", ac,
    `Modifiers: Crushing ${formatSigned(acModifiers.crushing)}, Missile ${formatSigned(acModifiers.missile)}, Piercing ${formatSigned(acModifiers.piercing)}, Slashing ${formatSigned(acModifiers.slashing)}`);
  add("MEMBER DETAILS", order, name, "Combat", "THAC0", thac0,
    `Current main-hand or ranged loadout${untrainedPenalty ? `; non-proficiency penalty: +${untrainedPenalty}` : ""}`);
  add("MEMBER DETAILS", order, name, "Combat", "Damage", `${damageMin}-${damageMax}`, "Current main-hand or ranged loadout; on-hit secondary effects are not included in the record-screen range");
  add("MEMBER DETAILS", order, name, "Combat", "Attacks Per Round", attacksDisplay);
  add("MEMBER DETAILS", order, name, "Combat", "Selected Weapon", loadout.weapon?.definition.identified_name ?? "Fist",
    loadout.ammo ? `Ammunition: ${(loadout.ammo.instance.flags_raw & 1) ? loadout.ammo.definition.identified_name : loadout.ammo.definition.unidentified_name}` : "");
  for (const [field, value] of Object.entries({ Strength: strength, Dexterity: dexterity, Constitution: constitution, Intelligence: intelligence, Wisdom: wisdom, Charisma: charisma })) {
    const base = h[`${field.toLowerCase()}_raw`];
    add("MEMBER DETAILS", order, name, "Attributes", field, value, base !== value ? `Base ${base}` : "");
  }
  for (const [field, value] of Object.entries({ "Death/Poison": saves.death, Wands: saves.wands, "Petrification/Polymorph": saves.polymorph, Breath: saves.breath, Spells: saves.spells })) {
    add("MEMBER DETAILS", order, name, "Saving Throws", field, value);
  }
  for (const [field, key] of [["Fire", "fire"], ["Cold", "cold"], ["Electricity", "electricity"], ["Acid", "acid"], ["Magic", "magic"], ["Magic Fire", "magic_fire"], ["Magic Cold", "magic_cold"], ["Slashing", "slashing"], ["Crushing", "crushing"], ["Piercing", "piercing"], ["Missile", "missile"]]) {
    add("MEMBER DETAILS", order, name, "Resistances", field, `${resistances[key]}%`);
  }
  add("MEMBER DETAILS", order, name, "Class Skills", "Lore", lore);
  add("MEMBER DETAILS", order, name, "Class Skills", "Reputation", h.reputation_raw / 10);
  if ([4, 9, 13, 15].includes(h.object_ids_raw.class)) {
    const inactive = h.object_ids_raw.class === 13 && h.levels_raw[0] <= h.levels_raw[1];
    for (const [rawKey, , label] of SKILL_COLUMNS) {
      add("MEMBER DETAILS", order, name, "Thieving Skills", label, skillValues[rawKey], inactive ? "Inactive dual-class abilities" : "");
    }
  }
  if (h.object_ids_raw.class === 3) add("MEMBER DETAILS", order, name, "Class Skills", "Turn Undead Level", h.levels_raw[0]);

  const stats = member.npc_record.character_stats;
  add("MEMBER DETAILS", order, name, "Record Statistics", "Most Powerful Vanquished", tlk.get(stats.most_powerful_vanquished_strref) ?? "");
  add("MEMBER DETAILS", order, name, "Record Statistics", "Game Kills", stats.game_kill_count, `${stats.game_kill_xp} XP`);
  add("MEMBER DETAILS", order, name, "Record Statistics", "Chapter Kills", stats.chapter_kill_count, `${stats.chapter_kill_xp} XP`);
  const favoriteSpell = spellDefinitions.get(stats.favorite_spell_resrefs[0]);
  if (favoriteSpell) add("MEMBER DETAILS", order, name, "Record Statistics", "Favorite Spell", favoriteSpell.name);
  const favoriteWeapon = itemDefinitions.get(stats.favorite_weapon_resrefs[0]);
  if (favoriteWeapon) add("MEMBER DETAILS", order, name, "Record Statistics", "Favorite Weapon", favoriteWeapon.identified_name);

  const memberContainers = [];
  for (let slot = 0; slot <= 37; slot += 1) {
    const item = partyItem(member, slot);
    if (!item) continue;
    const identified = Boolean(item.instance.flags_raw & 1);
    const itemName = identified ? item.definition.identified_name : item.definition.unidentified_name;
    const state = slot <= 17 ? (slot === 2 && loadout.twoHanded ? "Equipped but inactive with current two-handed weapon" : "Equipped")
      : slot <= 20 ? "Quick Item" : "Carried";
    const quantities = [item.instance.charge_1_or_quantity_raw, item.instance.charge_2_raw, item.instance.charge_3_raw];
    const visibleAmounts = quantities.filter((value) => value > 0).join("/");
    add("EQUIPMENT", order, name, state, SLOT_NAMES[slot], itemName, visibleAmounts ? `Quantity/charges: ${visibleAmounts}` : "");
    const store = containerStores.get(item.instance.resref);
    if (store) memberContainers.push({ itemName, store });
  }

  for (const { itemName: containerName, store } of memberContainers) {
    if (!store.items.length) {
      add("CONTAINER CONTENTS", order, name, "Container", containerName, "(Empty)", "Item count: 0");
      continue;
    }
    for (const storedItem of store.items) {
      const definition = itemDefinitions.get(storedItem.resref);
      if (!definition) throw new Error(`Missing container item definition ${storedItem.resref}`);
      const identified = Boolean(storedItem.flags_raw & 1);
      const storedItemName = identified ? definition.identified_name : definition.unidentified_name;
      const stock = storedItem.infinite_supply_raw ? "Infinite" : storedItem.amount_in_stock_raw;
      const detail = [`Count: ${stock}`];
      const hasCharges = definition.abilities.some((ability) => ability.max_charges > 0);
      if (hasCharges) {
        const charges = [storedItem.charge_1_or_quantity_raw, storedItem.charge_2_raw, storedItem.charge_3_raw].filter((value) => value > 0);
        if (charges.length) detail.push(`Charges per item: ${charges.join("/")}`);
      } else if (definition.stack_amount > 1 && storedItem.charge_1_or_quantity_raw > 0) {
        const quantity = storedItem.infinite_supply_raw ? "Infinite" : storedItem.charge_1_or_quantity_raw * storedItem.amount_in_stock_raw;
        detail[0] = `Quantity: ${quantity}`;
      }
      add("CONTAINER CONTENTS", order, name, "Container", containerName, storedItemName || "Unknown Item", detail.join("; "));
    }
  }

  for (const proficiency of proficiencyEntries(member)) {
    add("PROFICIENCIES", order, name, proficiency.name.includes("Style") ? "Fighting Style" : "Weapon Proficiency",
      proficiency.name, "*".repeat(proficiency.pips), proficiency.active ? `${proficiency.pips} pip(s)` : `${proficiency.pips} pip(s); inactive original-class proficiency`);
  }

  const spellInfoByKey = new Map();
  for (const info of member.embedded_cre_record.spell_memorization_info) {
    if (info.maximum_memorizable_raw === 0 && info.memorized_spell_entry_count_raw === 0) continue;
    const key = `${info.type_raw}:${info.level_raw}`;
    const maximum = spellSlotMax(member, info, effects, wisdom);
    const memorized = member.embedded_cre_record.memorized_spells.slice(
      info.first_memorized_spell_index_raw,
      info.first_memorized_spell_index_raw + info.memorized_spell_entry_count_raw,
    );
    const available = memorized.filter((spell) => spell.flags_raw & 1).length;
    const isSorcererPool = h.object_ids_raw.class === 19 && info.type_raw === 1;
    let detail;
    if (isSorcererPool) {
      const bySpell = new Map();
      for (const spell of memorized) {
        const current = bySpell.get(spell.resref) ?? 0;
        bySpell.set(spell.resref, current + ((spell.flags_raw & 1) ? 1 : 0));
      }
      const remaining = bySpell.size ? Math.max(...bySpell.values()) : 0;
      detail = `Cast slots remaining: ${remaining}/${maximum}`;
    } else {
      detail = `Prepared: ${memorized.length}/${maximum}; currently available: ${available}`;
    }
    add("SPELLS", order, name, "Spell Slots", `${SPELL_TYPES[info.type_raw] ?? "Unknown"} Level ${info.level_raw + 1}`, maximum, detail);
    spellInfoByKey.set(key, { info, maximum, memorized });
  }

  for (const known of member.embedded_cre_record.known_spells) {
    const definition = spellDefinitions.get(known.resref);
    const key = `${known.type_raw}:${known.level_raw}`;
    const castable = (spellInfoByKey.get(key)?.maximum ?? 0) > 0;
    add("SPELLS", order, name, "Known Spells", `${SPELL_TYPES[known.type_raw] ?? "Unknown"} Level ${known.level_raw + 1}`, definition?.name ?? "Unknown Spell", castable ? "Castable at current level" : "Known but no current spell slots");
  }

  for (const [key, group] of spellInfoByKey) {
    const [typeRaw, levelRaw] = key.split(":").map(Number);
    if (h.object_ids_raw.class === 19 && typeRaw === 1) continue;
    const aggregated = new Map();
    for (const spell of group.memorized) {
      const value = aggregated.get(spell.resref) ?? { prepared: 0, available: 0 };
      value.prepared += 1;
      if (spell.flags_raw & 1) value.available += 1;
      aggregated.set(spell.resref, value);
    }
    for (const [resref, counts] of aggregated) {
      add("SPELLS", order, name, typeRaw === 2 ? "Innate Uses" : "Prepared Spells",
        `${SPELL_TYPES[typeRaw] ?? "Unknown"} Level ${levelRaw + 1}`, spellDefinitions.get(resref)?.name ?? "Unknown Spell",
        `Prepared/uses: ${counts.prepared}; currently available: ${counts.available}`);
    }
  }

  derivedMembers.push({ name, order, ac, thac0, damage: `${damageMin}-${damageMax}`, attacks, lore, skillValues, spellInfoByKey });
}

add("DATA NOTES", "", "", "Scope", "Export Scope", "Player-visible values only", "Internal local variables and raw effect records are excluded");
add("DATA NOTES", "", "", "Language", "Game Text", language, "Names are read from the installed game's dialog.tlk");
add("DATA NOTES", "", "", "Combat", "Current Loadout", "Applied", "Armor Class, THAC0, damage, attacks, and weapon non-proficiency penalties use the weapon or ammunition selected in the save");
add("DATA NOTES", "", "", "Thieving Skills", "Modifiers", "Applied", "Base allocation plus race, current Dexterity, and equipped-item modifiers");
add("DATA NOTES", "", "", "Lore", "Modifiers", "Applied", "Class lore plus Intelligence and Wisdom modifiers");
add("DATA NOTES", "", "", "Spells", "Modifiers", "Applied", "Wisdom bonus slots and equipped spell-slot items are included");
add("DATA NOTES", "", "", "Containers", "Saved Contents", raw.container_source_available ? "Included" : "Unavailable", raw.container_source_available ? "Contents of party-held bags, cases, potion containers, and SoD key rings are read from BALDUR.SAV store records" : "BALDUR.SAV was not available; container contents could not be read");
add("DATA NOTES", "", "", "Validation", "Source Resources", `Installed ${resources.campaign || "BGEE"} resources`, `Layers: ${(resources.resource_layers || ["base"]).join(" + ")}; ITM, SPL, 2DA, WMP, and TLK resources from the matching installation were used`);

const csvText = csvFromRows(rows);
if (rows.length < 20 || rows.some((row) => row.length !== 7)) throw new Error("CSV structural validation failed");
const internalIdentifiers = new Set([
  raw.game_header.current_area_resref,
  ...raw.party_members.map((member) => member.npc_record.character_resref),
  ...resources.items.map((item) => item.resref),
  ...resources.spells.map((spell) => spell.resref),
].filter(Boolean));
const leakedIdentifiers = [...new Set(rows.flat().filter((cell) => internalIdentifiers.has(String(cell))))];
if (leakedIdentifiers.length) throw new Error(`Internal resource identifiers leaked into visible CSV: ${leakedIdentifiers.join(", ")}`);

await fs.mkdir(path.dirname(outputCsvPath), { recursive: true });
await fs.writeFile(outputCsvPath, csvText, "utf8");

console.log(JSON.stringify({
  output: outputCsvPath,
  rows_including_header: rows.length,
  party_members: derivedMembers.length,
  sections: [...new Set(rows.slice(1).map((row) => row[0]))],
  validation: "seven-column structure + internal identifier leak check",
  cjk_characters: (csvText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) || []).length,
}, null, 2));
