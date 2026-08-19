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

const [dexMod, skillDex, skillRac, loreBon, wisSlots, wSpecial, wspAtck, raceThac, kitList, hpConBon, strMod, strModEx, styleBonu, monkFist] = await Promise.all([
  load2da("DEXMOD"),
  load2da("SKILLDEX"),
  load2da("SKILLRAC"),
  load2da("LOREBON"),
  load2da("MXSPLWIS"),
  load2da("WSPECIAL"),
  load2da("WSPATCK"),
  load2da("RACETHAC"),
  load2da("KITLIST"),
  load2da("HPCONBON"),
  load2da("STRMOD"),
  load2da("STRMODEX"),
  load2da("STYLBONU"),
  load2da("MONKFIST"),
]);

const itemDefinitions = new Map(resources.items.map((item) => [item.resref, item]));
const spellDefinitions = new Map(resources.spells.map((spell) => [spell.resref, spell]));
const containerStoreRecords = raw.container_stores || [];
const duplicateContainerStoreResrefs = [...new Set(containerStoreRecords
  .filter((store, index) => containerStoreRecords.findIndex((candidate) => candidate.resref === store.resref) !== index)
  .map((store) => store.resref))];
if (duplicateContainerStoreResrefs.length) {
  throw new Error(`Ambiguous duplicate saved store records: ${duplicateContainerStoreResrefs.join(", ")}`);
}
const containerStores = new Map(containerStoreRecords.map((store) => [store.resref, store]));
const sodPartyChest = raw.sod_party_chest || null;
if (sodPartyChest && raw.game_header.current_campaign.toUpperCase() !== "SOD") {
  throw new Error("A SoD party chest was attached to a non-SoD save");
}
if (sodPartyChest && !raw.sod_party_chest_source_available) {
  throw new Error("BALDUR.SAV is required to export the SoD party chest");
}
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
const CLASS_HP_RULES = {
  Mage: { constitutionLevelCap: 10, warrior: false },
  Fighter: { constitutionLevelCap: 9, warrior: true },
  Cleric: { constitutionLevelCap: 9, warrior: false },
  Thief: { constitutionLevelCap: 10, warrior: false },
  Bard: { constitutionLevelCap: 10, warrior: false },
  Paladin: { constitutionLevelCap: 9, warrior: true },
  Druid: { constitutionLevelCap: 9, warrior: false },
  Ranger: { constitutionLevelCap: 9, warrior: true },
  Sorcerer: { constitutionLevelCap: 10, warrior: false },
  Monk: { constitutionLevelCap: 9, warrior: false },
  Shaman: { constitutionLevelCap: 9, warrior: false },
};
const DUAL_CLASS_ORIGINAL_BY_FLAG = new Map([
  [0x0008, "Fighter"],
  [0x0010, "Mage"],
  [0x0020, "Cleric"],
  [0x0040, "Thief"],
  [0x0080, "Druid"],
  [0x0100, "Ranger"],
]);
const DUAL_CLASS_ORIGINAL_MASK = 0x01f8;
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

function nonProficiencyPenalty(member) {
  // BGEE Adventurer's Guide: warrior -2, rogue/priest -3, wizard -5.
  if (activeWarriorLevel(member)) return 2;
  const components = CLASS_COMPONENTS[member.embedded_cre_record.header.object_ids_raw.class] ?? [];
  if (components.some((component) => ["Cleric", "Druid", "Shaman", "Thief", "Bard"].includes(component))) return 3;
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

function fistItem(member) {
  const h = member.embedded_cre_record.header;
  let resref = "FIST";
  if (h.object_ids_raw.class === 20) {
    const numericLevels = monkFist.rows.map((row) => Number(row.row_name)).filter(Number.isFinite);
    const fistLevel = Math.max(1, Math.min(Math.max(...numericLevels), h.levels_raw[0]));
    resref = String(tableRow(monkFist, fistLevel).cells.RESREF ?? monkFist.default_value).toUpperCase();
  }
  const definition = itemDefinitions.get(resref);
  if (!definition) throw new Error(`Missing fist item definition ${resref}`);
  return { slotIndex: "fist", instance: { resref, flags_raw: 1 }, definition };
}

function currentLoadout(member) {
  const selection = signedWord(member.embedded_cre_record.item_slots[38].value_raw) + 35;
  let weaponSlot = null;
  let ammoSlot = null;
  if (selection >= 35 && selection <= 38) {
    weaponSlot = 9 + selection - 35;
  } else if (selection >= 11 && selection <= 14) {
    ammoSlot = 13 + selection - 11;
    const ammo = partyItem(member, ammoSlot);
    const launcherRequired = ammo?.definition.abilities[0]?.launcher_required ?? 0;
    const launcherCategoryByItemType = { 15: 1, 27: 2, 18: 3 };
    for (let slot = 9; slot <= 12; slot += 1) {
      const candidate = partyItem(member, slot);
      const candidateCategory = launcherCategoryByItemType[candidate?.definition.item_type];
      if (candidate?.definition.abilities.some((ability) => ability.attack_type === 4)
          && (!launcherRequired || candidateCategory === launcherRequired)) {
        weaponSlot = slot;
        break;
      }
    }
    if (ammo && weaponSlot === null) {
      throw new Error(`No compatible launcher found for selected ammunition ${ammo.instance.resref}`);
    }
  }
  const weapon = weaponSlot === null ? fistItem(member) : partyItem(member, weaponSlot);
  const ammo = ammoSlot === null ? null : partyItem(member, ammoSlot);
  const abilityIndex = member.embedded_cre_record.item_slots[39].value_raw;
  const weaponAbility = weapon?.definition.abilities[abilityIndex] ?? weapon?.definition.abilities[0] ?? null;
  const ammoAbility = ammo?.definition.abilities[0] ?? null;
  const ranged = weaponAbility?.attack_type === 2 || weaponAbility?.attack_type === 4 || ammoAbility?.attack_type === 2;
  const twoHanded = Boolean((weapon?.definition.flags_raw ?? 0) & 0x02);
  return { selection, weaponSlot, ammoSlot, weapon, ammo, weaponAbility, ammoAbility, ranged, twoHanded };
}

function activeItems(member, loadout) {
  const active = [];
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 17]) {
    if (slot === 2 && loadout.twoHanded) continue;
    const item = partyItem(member, slot);
    if (item) active.push(item);
  }
  if (loadout.weapon) active.push(loadout.weapon);
  if (loadout.ammo) active.push(loadout.ammo);
  return [...new Map(active.map((item) => [item.slotIndex, item])).values()];
}

function equippedEffects(items) {
  return items.flatMap((item) => item.definition.equipping_effects);
}

function savedEffectIsActive(effect) {
  if (effect.timing_mode_raw === 9) return true;
  if (effect.timing_mode_raw === 4096) {
    return Number(effect.duration_raw) > Number(raw.game_header.game_time_raw) * 15;
  }
  return false;
}

function normalizeSavedEffect(effect) {
  return {
    opcode: effect.opcode_raw,
    parameter_1_int32: effect.parameter_1_raw_int32,
    parameter_1_uint32: effect.parameter_1_raw_uint32,
    parameter_2_uint32: effect.parameter_2_raw >>> 0,
    dice_thrown: 0,
    dice_sides: 0,
    timing_mode: effect.timing_mode_raw,
    source_kind: "saved-cre-effect",
  };
}

function activeSavedEffects(member) {
  return member.embedded_cre_record.effects.records
    .filter(savedEffectIsActive)
    .map(normalizeSavedEffect);
}

function applyNumericModifier(base, effect, label) {
  switch (effect.parameter_2_uint32) {
    case 0:
    case 3:
      return base + effect.parameter_1_int32;
    case 1:
      return effect.parameter_1_int32;
    case 2:
      return Math.trunc(base * effect.parameter_1_int32 / 100);
    default:
      throw new Error(`Unsupported ${label} modifier type ${effect.parameter_2_uint32} for opcode ${effect.opcode}`);
  }
}

function applyLowerIsBetterModifier(base, effect, label) {
  switch (effect.parameter_2_uint32) {
    case 0:
    case 3:
      return base - effect.parameter_1_int32;
    case 1:
      return effect.parameter_1_int32;
    case 2:
      return Math.trunc(base * effect.parameter_1_int32 / 100);
    default:
      throw new Error(`Unsupported ${label} modifier type ${effect.parameter_2_uint32} for opcode ${effect.opcode}`);
  }
}

function applyAttributeEffects(base, opcode, effects) {
  let value = base;
  for (const effect of effects.filter((candidate) => candidate.opcode === opcode)) {
    value = applyNumericModifier(value, effect, "attribute");
  }
  return value;
}

function applyResistanceEffect(base, effect) {
  switch (effect.parameter_2_uint32) {
    case 0:
      return base + effect.parameter_1_int32;
    case 1:
      return effect.parameter_1_int32;
    case 2:
      if (effect.opcode === 166) {
        throw new Error("Unsupported equipped magic-resistance percentage modifier type");
      }
      return Math.trunc(base * effect.parameter_1_int32 / 100);
    default:
      throw new Error(`Unsupported equipped resistance modifier type ${effect.parameter_2_uint32} for opcode ${effect.opcode}`);
  }
}

function constitutionHpPerLevel(constitution, warrior) {
  const tableConstitution = Math.max(1, Math.min(25, constitution));
  return tableNumber(hpConBon, tableConstitution, warrior ? "WARRIOR" : "OTHER");
}

function dualClassOriginal(componentNames, creatureFlags) {
  const originalBits = creatureFlags & DUAL_CLASS_ORIGINAL_MASK;
  if (!originalBits || (originalBits & (originalBits - 1)) !== 0) return null;
  const original = DUAL_CLASS_ORIGINAL_BY_FLAG.get(originalBits) ?? null;
  return original && componentNames.includes(original) ? original : null;
}

function activeComponentLevel(member, componentName) {
  const h = member.embedded_cre_record.header;
  const componentNames = CLASS_COMPONENTS[h.object_ids_raw.class] ?? [];
  const componentIndex = componentNames.indexOf(componentName);
  if (componentIndex < 0) return 0;
  const originalClass = dualClassOriginal(componentNames, h.creature_flags_raw);
  if (originalClass === componentName) {
    const originalIndex = componentIndex;
    const currentIndex = originalIndex === 0 ? 1 : 0;
    if (h.levels_raw[currentIndex] <= h.levels_raw[originalIndex]) return 0;
  }
  return h.levels_raw[componentIndex] ?? 0;
}

function activeWarriorLevel(member) {
  return Math.max(...["Fighter", "Paladin", "Ranger"].map((component) => activeComponentLevel(member, component)));
}

function constitutionHpAdjustment(member, constitution) {
  const h = member.embedded_cre_record.header;
  const componentNames = CLASS_COMPONENTS[h.object_ids_raw.class];
  if (!componentNames?.length) return 0;
  const rules = componentNames.map((component) => CLASS_HP_RULES[component]);
  if (rules.some((rule) => !rule)) return 0;

  if (componentNames.length === 1) {
    const level = Math.min(h.levels_raw[0], rules[0].constitutionLevelCap);
    return level * constitutionHpPerLevel(constitution, rules[0].warrior);
  }

  const originalClass = dualClassOriginal(componentNames, h.creature_flags_raw);
  if (originalClass) {
    const originalIndex = componentNames.indexOf(originalClass);
    const currentIndex = originalIndex === 0 ? 1 : 0;
    const originalRule = rules[originalIndex];
    const currentRule = rules[currentIndex];
    const originalLevel = h.levels_raw[originalIndex];
    const currentLevel = h.levels_raw[currentIndex];
    const originalBonusLevels = Math.min(originalLevel, originalRule.constitutionLevelCap);
    let currentBonusLevels = 0;
    if (currentLevel > originalLevel) {
      currentBonusLevels = Math.max(0, Math.min(currentLevel, currentRule.constitutionLevelCap) - originalLevel);
      // In the EE rules a level-9 warrior/priest dualled to a class with ten
      // hit dice does not gain a tenth Constitution bonus hit die.
      if (originalLevel >= 9 && originalRule.constitutionLevelCap === 9) currentBonusLevels = 0;
    }
    return originalBonusLevels * constitutionHpPerLevel(constitution, originalRule.warrior)
      + currentBonusLevels * constitutionHpPerLevel(constitution, currentRule.warrior);
  }

  const levelCap = Math.min(...rules.map((rule) => rule.constitutionLevelCap));
  const totalLevels = h.levels_raw.slice(0, componentNames.length).reduce((sum, level) => sum + level, 0);
  const perLevel = constitutionHpPerLevel(constitution, rules.some((rule) => rule.warrior));
  return Math.trunc(Math.min(totalLevels, levelCap * componentNames.length) * perLevel / componentNames.length);
}

function maximumHpWithEquipment(baseMaximum, effects) {
  let maximum = baseMaximum;
  let nonCumulative = null;
  for (const effect of effects.filter((candidate) => candidate.opcode === 18)) {
    if (effect.dice_thrown) {
      throw new Error("Cannot derive a deterministic equipped maximum-HP dice effect from the saved CRE");
    }
    const amount = effect.parameter_1_int32;
    switch (effect.parameter_2_uint32) {
      case 0:
      case 3:
        maximum += amount;
        break;
      case 1:
      case 4:
        maximum = amount;
        break;
      case 2:
      case 5:
        maximum = Math.trunc(baseMaximum * amount / 100);
        break;
      case 6:
        nonCumulative = nonCumulative === null ? amount : Math.max(nonCumulative, amount);
        break;
      default:
        throw new Error(`Unsupported equipped maximum-HP modifier type ${effect.parameter_2_uint32}`);
    }
  }
  return maximum + (nonCumulative ?? 0);
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

function strengthBonuses(strength, exceptionalStrength = 0) {
  const tableStrength = Math.max(0, Math.min(25, strength));
  let hit = tableNumber(strMod, tableStrength, "TO_HIT");
  let damage = tableNumber(strMod, tableStrength, "DAMAGE");
  if (strength === 18 && exceptionalStrength > 0) {
    const tableExceptional = Math.max(1, Math.min(100, exceptionalStrength));
    hit += tableNumber(strModEx, tableExceptional, "TO_HIT");
    damage += tableNumber(strModEx, tableExceptional, "DAMAGE");
  }
  return { hit, damage };
}

function strengthDisplay(strength, exceptionalStrength) {
  if (strength !== 18 || exceptionalStrength <= 0) return String(strength);
  return `18/${exceptionalStrength === 100 ? "00" : String(exceptionalStrength).padStart(2, "0")}`;
}

function weaponSpecialization(pips) {
  const rowName = Math.min(5, pips);
  return {
    hit: tableNumber(wSpecial, rowName, "HIT"),
    damage: tableNumber(wSpecial, rowName, "DAMAGE"),
  };
}

function attackIncrement(member, pips) {
  const h = member.embedded_cre_record.header;
  const warriorLevel = activeWarriorLevel(member);
  if (!warriorLevel) return 0;
  const row = tableRow(wspAtck, Math.min(5, pips));
  const encoded = Number(row.values[Math.max(0, Math.min(row.values.length - 1, warriorLevel - 1))]);
  return encoded >= 0 ? encoded : Math.abs(encoded) - 0.5;
}

function encodedAttackValue(encoded) {
  const sign = encoded < 0 ? -1 : 1;
  const absolute = Math.abs(encoded);
  if (absolute <= 5) return sign * absolute;
  if (absolute <= 10) return sign * (absolute - 5.5);
  throw new Error(`Unsupported attacks-per-round encoded value ${encoded}`);
}

function attacksWithEffects(base, effects) {
  let value = encodedAttackValue(base);
  let finalValue = false;
  for (const effect of effects.filter((candidate) => candidate.opcode === 1)) {
    switch (effect.parameter_2_uint32) {
      case 0:
        value += encodedAttackValue(effect.parameter_1_int32);
        break;
      case 1:
        value = encodedAttackValue(effect.parameter_1_int32);
        break;
      case 2:
        value = value * effect.parameter_1_int32 / 100;
        break;
      case 3:
        value = encodedAttackValue(effect.parameter_1_int32);
        finalValue = true;
        break;
      default:
        throw new Error(`Unsupported attacks-per-round modifier type ${effect.parameter_2_uint32}`);
    }
  }
  return { value, finalValue };
}

function spellSlotMax(member, info, effects, currentWisdom) {
  let maximum = info.maximum_memorizable_raw;
  if (info.type_raw === 0 && currentWisdom >= 13) {
    maximum += tableNumber(wisSlots, currentWisdom, String(info.level_raw + 1));
  }
  const slotOpcode = info.type_raw === 0 ? 62 : info.type_raw === 1 ? 42 : null;
  if (slotOpcode !== null) {
    const spellLevel = info.level_raw + 1;
    for (const effect of effects.filter((candidate) => candidate.opcode === slotOpcode)) {
      const mode = effect.parameter_2_uint32;
      if (mode === 0) {
        if (spellLevel <= effect.parameter_1_int32) maximum *= 2;
        continue;
      }
      if (mode & (1 << info.level_raw)) maximum += effect.parameter_1_int32;
      if ((mode & 0x200) && spellLevel === effect.parameter_1_int32) maximum *= 2;
    }
  }
  return maximum;
}

function visibleContainerItem(item, definition) {
  if (!definition) throw new Error(`Missing container item definition ${item.resref}`);
  const identified = Boolean(item.flags_raw & 1);
  const itemName = identified ? definition.identified_name : definition.unidentified_name;
  const amountInStock = item.amount_in_stock_raw ?? 1;
  const stock = item.infinite_supply_raw ? "Infinite" : amountInStock;
  const detail = [`Count: ${stock}`];
  const hasCharges = definition.abilities.some((ability) => ability.max_charges > 0);
  if (hasCharges) {
    const charges = [item.charge_1_or_quantity_raw, item.charge_2_raw, item.charge_3_raw].filter((value) => value > 0);
    if (charges.length) detail.push(`Charges per item: ${charges.join("/")}`);
  } else if (definition.stack_amount > 1 && item.charge_1_or_quantity_raw > 0) {
    const quantity = item.infinite_supply_raw ? "Infinite" : item.charge_1_or_quantity_raw * amountInStock;
    detail[0] = `Quantity: ${quantity}`;
  }
  return { itemName: itemName || "Unknown Item", detail: detail.join("; ") };
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
const sortedMembers = [...raw.party_members].sort((a, b) => a.npc_record.party_order_raw - b.npc_record.party_order_raw);
const playerName = sortedMembers.length ? displayName(sortedMembers[0]) : "Player";
const heldContainerOccurrences = sortedMembers.flatMap((member) => {
  const occurrences = [];
  for (let slot = 0; slot <= 37; slot += 1) {
    const item = partyItem(member, slot);
    const store = item ? containerStores.get(item.instance.resref) : null;
    if (!item || !store) continue;
    const identified = Boolean(item.instance.flags_raw & 1);
    const itemName = identified ? item.definition.identified_name : item.definition.unidentified_name;
    occurrences.push({ member, slot, itemName, store });
  }
  return occurrences;
});
const containerNameTotals = new Map();
for (const occurrence of heldContainerOccurrences) {
  containerNameTotals.set(occurrence.itemName, (containerNameTotals.get(occurrence.itemName) || 0) + 1);
}
const containerNameSeen = new Map();
const containerOccurrenceLabels = new Map();
for (const occurrence of heldContainerOccurrences) {
  const ordinal = (containerNameSeen.get(occurrence.itemName) || 0) + 1;
  containerNameSeen.set(occurrence.itemName, ordinal);
  const numberedName = containerNameTotals.get(occurrence.itemName) > 1
    ? `${occurrence.itemName} #${ordinal}`
    : occurrence.itemName;
  containerOccurrenceLabels.set(`${occurrence.member.source_index}:${occurrence.slot}`, `${numberedName} (${SLOT_NAMES[occurrence.slot]})`);
}
for (const member of sortedMembers) {
  const order = member.npc_record.party_order_raw;
  const name = displayName(member);
  const h = member.embedded_cre_record.header;
  const race = RACES[h.object_ids_raw.race] ?? { name: "Unknown Race", table: "HUMAN" };
  const loadout = currentLoadout(member);
  const items = activeItems(member, loadout);
  const itemEffects = equippedEffects(items);
  const savedEffects = activeSavedEffects(member);
  const effects = [...itemEffects, ...savedEffects];
  const strength = applyAttributeEffects(h.strength_raw, 44, effects);
  const exceptionalStrength = strength === 18 ? applyAttributeEffects(h.exceptional_strength_raw, 97, effects) : 0;
  const dexterity = applyAttributeEffects(h.dexterity_raw, 15, effects);
  const constitution = applyAttributeEffects(h.constitution_raw, 10, effects);
  const intelligence = applyAttributeEffects(h.intelligence_raw, 19, effects);
  const wisdom = applyAttributeEffects(h.wisdom_raw, 49, effects);
  const charisma = applyAttributeEffects(h.charisma_raw, 6, effects);
  const constitutionHp = constitutionHpAdjustment(member, constitution);
  const maximumHpBeforeConstitution = maximumHpWithEquipment(h.maximum_hp_raw, effects);
  const currentHp = h.current_hp_raw > 0 ? h.current_hp_raw + constitutionHp : h.current_hp_raw;
  const maximumHp = maximumHpBeforeConstitution + constitutionHp;

  const baseAcEffects = effects.filter((effect) => effect.opcode === 0 && effect.parameter_2_uint32 === 16);
  const baseAc = baseAcEffects.length ? Math.min(...baseAcEffects.map((effect) => effect.parameter_1_int32)) : h.armor_class_natural_raw;
  const generalAcBonus = effects.filter((effect) => effect.opcode === 0 && effect.parameter_2_uint32 === 0)
    .reduce((sum, effect) => sum + effect.parameter_1_int32, 0);
  const acModifiers = {
    crushing: h.armor_class_crushing_modifier_raw,
    missile: h.armor_class_missile_modifier_raw,
    piercing: h.armor_class_piercing_modifier_raw,
    slashing: h.armor_class_slashing_modifier_raw,
  };
  const acTypeByBit = { 1: "crushing", 2: "missile", 4: "piercing", 8: "slashing" };
  for (const effect of effects.filter((candidate) => candidate.opcode === 0 && candidate.parameter_2_uint32 !== 0 && candidate.parameter_2_uint32 !== 16)) {
    const unknownBits = effect.parameter_2_uint32 & ~0x0f;
    if (unknownBits) throw new Error(`Unsupported armor-class type mask ${effect.parameter_2_uint32}`);
    for (const [bit, field] of Object.entries(acTypeByBit)) {
      if (effect.parameter_2_uint32 & Number(bit)) acModifiers[field] -= effect.parameter_1_int32;
    }
  }
  const swordShieldPips = proficiencyPips(member, 112);
  if (partyItem(member, 2) && !loadout.twoHanded && swordShieldPips > 0) {
    acModifiers.missile += tableNumber(styleBonu, `SWORDANDSHIELD-${Math.min(2, swordShieldPips)}`, "AC_MISSILE");
  }
  const ac = baseAc + tableNumber(dexMod, dexterity, "AC") - generalAcBonus;

  const saves = { ...h.saving_throws_raw };
  const saveOpcode = { 33: "death", 34: "wands", 35: "polymorph", 36: "breath", 37: "spells" };
  for (const effect of effects.filter((candidate) => saveOpcode[candidate.opcode])) {
    const field = saveOpcode[effect.opcode];
    saves[field] = applyLowerIsBetterModifier(saves[field], effect, "saving throw");
  }
  for (const effect of effects.filter((candidate) => candidate.opcode === 325)) {
    for (const field of Object.keys(saves)) {
      saves[field] = applyLowerIsBetterModifier(saves[field], effect, "all saving throws");
    }
  }

  const resistances = { ...h.resistances_raw };
  const resistanceOpcode = {
    27: "acid", 28: "cold", 29: "electricity", 30: "fire",
    84: "magic_fire", 85: "magic_cold", 86: "slashing", 87: "crushing", 88: "piercing", 89: "missile",
    166: "magic",
  };
  for (const effect of effects.filter((candidate) => resistanceOpcode[candidate.opcode])) {
    const field = resistanceOpcode[effect.opcode];
    resistances[field] = applyResistanceEffect(resistances[field], effect);
  }

  const currentWeaponProf = loadout.weapon?.definition.proficiency_type_raw ?? 0;
  const currentPips = proficiencyPips(member, currentWeaponProf);
  const specialization = weaponSpecialization(currentPips);
  const weaponAbilityFlags = loadout.weaponAbility?.flags_raw ?? 0;
  const usesStrengthForThac0 = !loadout.ranged || Boolean(weaponAbilityFlags & 0x01) || Boolean(weaponAbilityFlags & 0x08);
  const currentStrengthBonuses = strengthBonuses(strength, exceptionalStrength);
  const physicalBonus = usesStrengthForThac0 ? currentStrengthBonuses.hit : tableNumber(dexMod, dexterity, "MISSILE");
  const weaponThacBonus = loadout.weaponAbility?.thac0_bonus ?? 0;
  const ammoThacBonus = loadout.ammoAbility?.thac0_bonus ?? 0;
  let effectModifiedThac0 = h.thac0_raw;
  for (const effect of effects.filter((candidate) => candidate.opcode === 54 || (candidate.opcode === 167 && loadout.ranged))) {
    effectModifiedThac0 = applyLowerIsBetterModifier(effectModifiedThac0, effect, "THAC0");
  }
  let racialThacBonus = 0;
  if (currentWeaponProf && raceThac.rows.some((row) => Number(row.row_name) === currentWeaponProf)) {
    racialThacBonus = tableNumber(raceThac, currentWeaponProf, race.table);
  }
  const untrainedPenalty = currentWeaponProf && currentPips === 0 ? nonProficiencyPenalty(member) : 0;
  const thac0 = effectModifiedThac0 - physicalBonus - weaponThacBonus - ammoThacBonus
    - specialization.hit - racialThacBonus + untrainedPenalty;

  const usesStrengthForDamage = !loadout.ranged || Boolean(weaponAbilityFlags & 0x01) || Boolean(weaponAbilityFlags & 0x04);
  const strengthDamage = usesStrengthForDamage ? currentStrengthBonuses.damage : 0;
  let passiveDamage = 0;
  for (const effect of effects.filter((candidate) => candidate.opcode === 73)) {
    passiveDamage = applyNumericModifier(passiveDamage, effect, "damage");
  }
  const damageAbility = loadout.ammoAbility ?? loadout.weaponAbility;
  const diceCount = damageAbility?.dice_thrown ?? 0;
  const diceSides = damageAbility?.dice_sides ?? 0;
  const damageBonus = (loadout.weaponAbility?.damage_bonus ?? 0) + (loadout.ammoAbility?.damage_bonus ?? 0)
    + strengthDamage + specialization.damage + passiveDamage;
  const damageMin = Math.max(1, (diceCount || 0) + damageBonus);
  const damageMax = Math.max(1, (diceCount && diceSides ? diceCount * diceSides : 0) + damageBonus);
  const effectAttacks = attacksWithEffects(h.attacks_raw, effects);
  const attacks = effectAttacks.value + (effectAttacks.finalValue ? 0 : attackIncrement(member, currentPips));
  const attacksDisplay = Number.isInteger(attacks) ? String(attacks) : `${Math.trunc(attacks * 2)}/2`;

  let lore = h.skills_raw.lore + tableNumber(loreBon, intelligence, "VALUE") + tableNumber(loreBon, wisdom, "VALUE");
  for (const effect of effects.filter((candidate) => candidate.opcode === 21)) {
    lore = applyNumericModifier(lore, effect, "lore");
  }
  lore = Math.max(0, lore);
  const skillValues = {};
  const raceSkillRow = tableRow(skillRac, race.table);
  const dexSkillRow = tableRow(skillDex, dexterity);
  for (const [rawKey, column] of SKILL_COLUMNS) {
    const base = rawKey === "hide_in_shadows" ? h.hide_in_shadows_raw : h.skills_raw[rawKey];
    skillValues[rawKey] = base + Number(raceSkillRow.cells[column] ?? 0) + Number(dexSkillRow.cells[column] ?? 0);
  }
  const thiefSkillOpcode = {
    59: "move_silently", 90: "open_locks", 91: "find_disarm_traps", 92: "pick_pockets",
    275: "hide_in_shadows", 276: "detect_illusion", 277: "set_traps",
  };
  for (const effect of effects.filter((candidate) => thiefSkillOpcode[candidate.opcode])) {
    const skill = thiefSkillOpcode[effect.opcode];
    skillValues[skill] = applyNumericModifier(skillValues[skill], effect, "thieving skill");
  }

  add("MEMBER DETAILS", order, name, "Identity", "Class and Level", classDisplay(member));
  add("MEMBER DETAILS", order, name, "Identity", "Race", race.name);
  add("MEMBER DETAILS", order, name, "Identity", "Gender", GENDERS[h.sex_raw] ?? "Unknown");
  add("MEMBER DETAILS", order, name, "Identity", "Alignment", ALIGNMENTS[h.object_ids_raw.alignment] ?? "Unknown");
  add("MEMBER DETAILS", order, name, "Progress", "Experience", h.experience_raw);
  const hpDetails = [];
  if (constitutionHp) hpDetails.push(`Constitution adjustment: ${formatSigned(constitutionHp)}`);
  if (maximumHpBeforeConstitution !== h.maximum_hp_raw) {
    hpDetails.push(`Equipped maximum-HP adjustment: ${formatSigned(maximumHpBeforeConstitution - h.maximum_hp_raw)}`);
  }
  add("MEMBER DETAILS", order, name, "Vitals", "Hit Points", `${currentHp}/${maximumHp}`, hpDetails.join("; "));
  add("MEMBER DETAILS", order, name, "Combat", "Armor Class", ac,
    `Modifiers: Crushing ${formatSigned(acModifiers.crushing)}, Missile ${formatSigned(acModifiers.missile)}, Piercing ${formatSigned(acModifiers.piercing)}, Slashing ${formatSigned(acModifiers.slashing)}`);
  add("MEMBER DETAILS", order, name, "Combat", "THAC0", thac0,
    `Current main-hand or ranged loadout${untrainedPenalty ? `; non-proficiency penalty: +${untrainedPenalty}` : ""}`);
  add("MEMBER DETAILS", order, name, "Combat", "Damage", `${damageMin}-${damageMax}`, "Current main-hand or ranged loadout; on-hit secondary effects are not included in the record-screen range");
  add("MEMBER DETAILS", order, name, "Combat", "Attacks Per Round", attacksDisplay);
  const selectedWeaponName = loadout.weapon
    ? ((loadout.weapon.instance.flags_raw & 1) ? loadout.weapon.definition.identified_name : loadout.weapon.definition.unidentified_name)
    : "Fist";
  add("MEMBER DETAILS", order, name, "Combat", "Selected Weapon", selectedWeaponName,
    loadout.ammo ? `Ammunition: ${(loadout.ammo.instance.flags_raw & 1) ? loadout.ammo.definition.identified_name : loadout.ammo.definition.unidentified_name}` : "");
  const attributeRows = [
    ["Strength", strengthDisplay(strength, exceptionalStrength), strengthDisplay(h.strength_raw, h.exceptional_strength_raw)],
    ["Dexterity", dexterity, h.dexterity_raw],
    ["Constitution", constitution, h.constitution_raw],
    ["Intelligence", intelligence, h.intelligence_raw],
    ["Wisdom", wisdom, h.wisdom_raw],
    ["Charisma", charisma, h.charisma_raw],
  ];
  for (const [field, value, base] of attributeRows) {
    add("MEMBER DETAILS", order, name, "Attributes", field, value, String(base) !== String(value) ? `Base ${base}` : "");
  }
  for (const [field, value] of Object.entries({ "Death/Poison": saves.death, Wands: saves.wands, "Petrification/Polymorph": saves.polymorph, Breath: saves.breath, Spells: saves.spells })) {
    add("MEMBER DETAILS", order, name, "Saving Throws", field, value);
  }
  for (const [field, key] of [["Fire", "fire"], ["Cold", "cold"], ["Electricity", "electricity"], ["Acid", "acid"], ["Magic", "magic"], ["Magic Fire", "magic_fire"], ["Magic Cold", "magic_cold"], ["Slashing", "slashing"], ["Crushing", "crushing"], ["Piercing", "piercing"], ["Missile", "missile"]]) {
    add("MEMBER DETAILS", order, name, "Resistances", field, `${resistances[key]}%`);
  }
  add("MEMBER DETAILS", order, name, "Class Skills", "Lore", lore);
  add("MEMBER DETAILS", order, name, "Class Skills", "Reputation", h.reputation_raw / 10);
  if ([4, 9, 10, 13, 15].includes(h.object_ids_raw.class)) {
    const inactive = activeComponentLevel(member, "Thief") === 0;
    for (const [rawKey, , label] of SKILL_COLUMNS) {
      add("MEMBER DETAILS", order, name, "Thieving Skills", label, skillValues[rawKey], inactive ? "Inactive dual-class abilities" : "");
    }
  }
  const clericLevel = activeComponentLevel(member, "Cleric");
  if (clericLevel) add("MEMBER DETAILS", order, name, "Class Skills", "Turn Undead Level", clericLevel);

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
    if (store) {
      const containerLabel = containerOccurrenceLabels.get(`${member.source_index}:${slot}`);
      if (!containerLabel) throw new Error(`Missing visible label for held container in ${SLOT_NAMES[slot]}`);
      memberContainers.push({ containerLabel, store });
    }
  }

  for (const { containerLabel, store } of memberContainers) {
    if (!store.items.length) {
      add("CONTAINER CONTENTS", order, name, "Container", containerLabel, "(Empty)", "Item count: 0");
      continue;
    }
    for (const storedItem of store.items) {
      const definition = itemDefinitions.get(storedItem.resref);
      const visible = visibleContainerItem(storedItem, definition);
      add("CONTAINER CONTENTS", order, name, "Container", containerLabel, visible.itemName, visible.detail);
    }
  }

  if (member === sortedMembers[0] && sodPartyChest) {
    const partyChestName = `${playerName}'s Equipment`;
    if (!sodPartyChest.items.length) {
      add("CONTAINER CONTENTS", "", "Party", "Party Chest", partyChestName, "(Empty)", "Item count: 0");
    } else {
      for (const chestItem of sodPartyChest.items) {
        const visible = visibleContainerItem(chestItem, itemDefinitions.get(chestItem.resref));
        add("CONTAINER CONTENTS", "", "Party", "Party Chest", partyChestName, visible.itemName, visible.detail);
      }
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

  derivedMembers.push({
    name, order, ac, thac0, damageMin, damageMax, attacks, lore, skillValues, spellInfoByKey, exceptionalStrength,
    attributes: { strength, dexterity, constitution, intelligence, wisdom, charisma }, saves, resistances,
  });
}

add("DATA NOTES", "", "", "Scope", "Export Scope", "Player-visible values only", "Internal local variables and raw effect records are excluded");
add("DATA NOTES", "", "", "Language", "Game Text", language, "Names are read from the installed game's dialog.tlk");
add("DATA NOTES", "", "", "Effects", "Current Modifiers", "Applied", "Equipped armor/accessories, the selected weapon and ammunition, permanent saved effects, and unexpired saved duration effects are included where they directly modify exported values");
add("DATA NOTES", "", "", "Combat", "Current Loadout", "Applied", "Armor Class, THAC0, damage, attacks, exceptional Strength, and weapon non-proficiency penalties use the weapon or ammunition selected in the save");
add("DATA NOTES", "", "", "Thieving Skills", "Modifiers", "Applied", "Base allocation plus race, current Dexterity, and equipped-item modifiers");
add("DATA NOTES", "", "", "Lore", "Modifiers", "Applied", "Class lore plus Intelligence and Wisdom modifiers");
add("DATA NOTES", "", "", "Spells", "Modifiers", "Applied", "Wisdom bonus slots and additive, level-range double, or exact-level double spell-slot effects are included");
add("DATA NOTES", "", "", "Containers", "Saved Contents", raw.container_source_available ? "Included" : "Unavailable", raw.container_source_available ? "Each party-held bag, case, potion container, or SoD key ring is matched to its saved BALDUR.SAV store and labeled by holder, inventory slot, and duplicate-name ordinal" : "BALDUR.SAV was not available; container contents could not be read");
if (raw.game_header.current_campaign.toUpperCase() === "SOD") {
  const partyChestStatus = !raw.sod_party_chest_source_available ? "Unavailable" : sodPartyChest ? "Included" : "Not Present";
  const partyChestDetail = !raw.sod_party_chest_source_available
    ? "BALDUR.SAV was not available; the SoD player/party equipment chest could not be read"
    : sodPartyChest
      ? "The active SoD player/party equipment chest is read from a saved ARE container"
      : "No saved SoD player/party equipment chest is present at this campaign stage";
  add("DATA NOTES", "", "", "Party Chest", "Saved Contents", partyChestStatus, partyChestDetail);
}
add("DATA NOTES", "", "", "Validation", "Source Resources", `Installed ${resources.campaign || "BGEE"} resources`, `Layers: ${(resources.resource_layers || ["base"]).join(" + ")}; ITM, SPL, 2DA, WMP, and TLK resources from the matching installation were used`);

const csvText = csvFromRows(rows);
if (rows.length < 20 || rows.some((row) => row.length !== 7)) throw new Error("CSV structural validation failed");
if (derivedMembers.length !== raw.game_header.party_members_count_raw) throw new Error("Derived party count does not match saved party count");
for (const member of derivedMembers) {
  const numericValues = [
    member.ac, member.thac0, member.damageMin, member.damageMax, member.attacks, member.lore,
    ...Object.values(member.attributes), ...Object.values(member.saves), ...Object.values(member.resistances),
    ...Object.values(member.skillValues), ...[...member.spellInfoByKey.values()].map((entry) => entry.maximum),
  ];
  if (numericValues.some((value) => !Number.isFinite(value))) throw new Error(`Non-finite derived value for ${member.name}`);
  if (member.damageMin < 1 || member.damageMax < member.damageMin) throw new Error(`Invalid damage range for ${member.name}`);
  if (member.attacks < 0) throw new Error(`Invalid attacks-per-round value for ${member.name}`);
  if (member.exceptionalStrength < 0 || member.exceptionalStrength > 100) throw new Error(`Invalid exceptional Strength for ${member.name}`);
}
const internalIdentifiers = new Set([
  raw.game_header.current_area_resref,
  sodPartyChest?.area_resref,
  sodPartyChest?.container_name,
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
  validation: "seven-column structure + derived numeric sanity + internal identifier leak check",
  cjk_characters: (csvText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) || []).length,
}, null, 2));
