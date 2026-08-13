import fs from "node:fs/promises";
import path from "node:path";

export const RESOURCE_TYPES = {
  ITM: 0x03ed,
  SPL: 0x03ee,
  EFF: 0x03f8,
  TWO_DA: 0x03f4,
  WMP: 0x03f7,
};

const EXTENSIONS = new Map([
  [RESOURCE_TYPES.ITM, "itm"],
  [RESOURCE_TYPES.SPL, "spl"],
  [RESOURCE_TYPES.EFF, "eff"],
  [RESOURCE_TYPES.TWO_DA, "2da"],
  [RESOURCE_TYPES.WMP, "wmp"],
]);

function fixedString(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end >= 0 ? end : raw.length).toString("ascii");
}

export class IEGameResources {
  constructor(gameDir, key, bifs, resources) {
    this.gameDir = gameDir;
    this.key = key;
    this.bifs = bifs;
    this.resources = resources;
    this.resourceMap = new Map(resources.map((entry) => [`${entry.resref.toUpperCase()}:${entry.type}`, entry]));
    this.bifCache = new Map();
  }

  static async open(gameDir) {
    const keyPath = path.join(gameDir, "chitin.key");
    const key = await fs.readFile(keyPath);
    if (fixedString(key, 0, 4) !== "KEY ") throw new Error("Invalid KEY signature");
    const bifCount = key.readUInt32LE(0x08);
    const resourceCount = key.readUInt32LE(0x0c);
    const bifOffset = key.readUInt32LE(0x10);
    const resourceOffset = key.readUInt32LE(0x14);
    const bifs = Array.from({ length: bifCount }, (_, index) => {
      const o = bifOffset + index * 12;
      const nameOffset = key.readUInt32LE(o + 4);
      const nameLength = key.readUInt16LE(o + 8);
      const name = fixedString(key, nameOffset, nameLength).replaceAll("\\", path.sep).replaceAll("/", path.sep);
      return { index, file_length_raw: key.readUInt32LE(o), name, location_flags_raw: key.readUInt16LE(o + 10) };
    });
    const resources = Array.from({ length: resourceCount }, (_, index) => {
      const o = resourceOffset + index * 14;
      const locator = key.readUInt32LE(o + 10);
      return {
        index,
        resref: fixedString(key, o, 8),
        type: key.readUInt16LE(o + 8),
        locator,
        bif_index: locator >>> 20,
        file_index: locator & 0x3fff,
        tileset_index: (locator >>> 14) & 0x3f,
      };
    });
    return new IEGameResources(gameDir, key, bifs, resources);
  }

  list(type = null) {
    return type === null ? [...this.resources] : this.resources.filter((entry) => entry.type === type);
  }

  async get(resref, type) {
    const ext = EXTENSIONS.get(type);
    if (ext) {
      const overridePath = path.join(this.gameDir, "override", `${resref}.${ext}`);
      try {
        return await fs.readFile(overridePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    const keyEntry = this.resourceMap.get(`${resref.toUpperCase()}:${type}`);
    if (!keyEntry) return null;
    const bifInfo = this.bifs[keyEntry.bif_index];
    if (!bifInfo) throw new Error(`Missing BIF index ${keyEntry.bif_index}`);
    const bif = await this.#loadBif(bifInfo);
    const fileCount = bif.readUInt32LE(0x08);
    const entriesOffset = bif.readUInt32LE(0x10);
    let fileEntryOffset = entriesOffset + keyEntry.file_index * 16;
    let locator = fileEntryOffset + 16 <= bif.length ? bif.readUInt32LE(fileEntryOffset) : -1;
    if ((locator & 0x3fff) !== keyEntry.file_index) {
      fileEntryOffset = -1;
      for (let i = 0; i < fileCount; i += 1) {
        const o = entriesOffset + i * 16;
        if ((bif.readUInt32LE(o) & 0x3fff) === keyEntry.file_index) {
          fileEntryOffset = o;
          break;
        }
      }
      if (fileEntryOffset < 0) throw new Error(`BIF entry not found for ${resref}.${ext || type}`);
    }
    const dataOffset = bif.readUInt32LE(fileEntryOffset + 4);
    const size = bif.readUInt32LE(fileEntryOffset + 8);
    const entryType = bif.readUInt16LE(fileEntryOffset + 12);
    if (entryType !== type) throw new Error(`Resource type mismatch for ${resref}: ${entryType} != ${type}`);
    return Buffer.from(bif.subarray(dataOffset, dataOffset + size));
  }

  async #loadBif(info) {
    if (this.bifCache.has(info.index)) return this.bifCache.get(info.index);
    const candidatePaths = [
      path.join(this.gameDir, info.name),
      path.join(this.gameDir, "data", path.basename(info.name)),
    ];
    let bif = null;
    for (const candidate of candidatePaths) {
      try {
        bif = await fs.readFile(candidate);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    if (!bif) throw new Error(`BIF not found: ${info.name}`);
    const signature = fixedString(bif, 0, 4);
    if (signature !== "BIFF") throw new Error(`Unsupported BIF signature ${signature}: ${info.name}`);
    this.bifCache.set(info.index, bif);
    return bif;
  }
}

export class DialogTLK {
  constructor(buffer) {
    this.buffer = buffer;
    if (fixedString(buffer, 0, 4) !== "TLK ") throw new Error("Invalid TLK signature");
    this.count = buffer.readUInt32LE(0x0a);
    this.stringDataOffset = buffer.readUInt32LE(0x0e);
  }

  static async open(filePath) {
    return new DialogTLK(await fs.readFile(filePath));
  }

  get(strref) {
    if (!Number.isInteger(strref) || strref < 0 || strref >= this.count) return null;
    const o = 0x12 + strref * 0x1a;
    const textOffset = this.buffer.readUInt32LE(o + 0x12);
    const textLength = this.buffer.readUInt32LE(o + 0x16);
    return this.buffer.subarray(this.stringDataOffset + textOffset, this.stringDataOffset + textOffset + textLength).toString("utf8");
  }
}

export function parseFeatureBlock(buffer, offset) {
  return {
    opcode: buffer.readUInt16LE(offset),
    target: buffer.readUInt8(offset + 0x02),
    power: buffer.readUInt8(offset + 0x03),
    parameter_1_uint32: buffer.readUInt32LE(offset + 0x04),
    parameter_1_int32: buffer.readInt32LE(offset + 0x04),
    parameter_2_uint32: buffer.readUInt32LE(offset + 0x08),
    parameter_2_int32: buffer.readInt32LE(offset + 0x08),
    timing_mode: buffer.readUInt8(offset + 0x0c),
    dispel_resistance: buffer.readUInt8(offset + 0x0d),
    duration: buffer.readUInt32LE(offset + 0x0e),
    probability_1: buffer.readUInt8(offset + 0x12),
    probability_2: buffer.readUInt8(offset + 0x13),
    resource_resref: fixedString(buffer, offset + 0x14, 8),
    dice_thrown: buffer.readUInt32LE(offset + 0x1c),
    dice_sides: buffer.readUInt32LE(offset + 0x20),
    saving_throw_type: buffer.readUInt32LE(offset + 0x24),
    saving_throw_bonus: buffer.readInt32LE(offset + 0x28),
    special: buffer.readUInt32LE(offset + 0x2c),
  };
}

export function parseItm(buffer, resref, tlk = null) {
  if (fixedString(buffer, 0, 4) !== "ITM ") throw new Error(`Invalid ITM signature: ${resref}`);
  const unidentifiedNameStrref = buffer.readUInt32LE(0x08);
  const identifiedNameStrref = buffer.readUInt32LE(0x0c);
  const identifiedDescriptionStrref = buffer.readUInt32LE(0x54);
  const extendedHeadersOffset = buffer.readUInt32LE(0x64);
  const extendedHeadersCount = buffer.readUInt16LE(0x68);
  const featureBlocksOffset = buffer.readUInt32LE(0x6a);
  const equippingFeatureIndex = buffer.readUInt16LE(0x6e);
  const equippingFeatureCount = buffer.readUInt16LE(0x70);
  const equippingEffects = Array.from({ length: equippingFeatureCount }, (_, i) => parseFeatureBlock(buffer, featureBlocksOffset + (equippingFeatureIndex + i) * 48));
  const abilities = Array.from({ length: extendedHeadersCount }, (_, index) => {
    const o = extendedHeadersOffset + index * 56;
    const featureCount = buffer.readUInt16LE(o + 0x1e);
    const featureIndex = buffer.readUInt16LE(o + 0x20);
    return {
      index,
      attack_type: buffer.readUInt8(o),
      id_requirement: buffer.readUInt8(o + 1),
      location: buffer.readUInt8(o + 2),
      target_type: buffer.readUInt8(o + 0x0c),
      range: buffer.readUInt16LE(o + 0x0e),
      launcher_required: buffer.readUInt8(o + 0x10),
      speed_factor: buffer.readUInt8(o + 0x12),
      thac0_bonus: buffer.readInt16LE(o + 0x14),
      dice_sides: buffer.readUInt8(o + 0x16),
      dice_thrown: buffer.readUInt8(o + 0x18),
      damage_bonus: buffer.readInt16LE(o + 0x1a),
      damage_type: buffer.readUInt16LE(o + 0x1c),
      feature_count: featureCount,
      feature_index: featureIndex,
      max_charges: buffer.readUInt16LE(o + 0x22),
      flags_raw: buffer.readUInt32LE(o + 0x26),
      projectile: buffer.readUInt16LE(o + 0x2a),
      effects: Array.from({ length: featureCount }, (_, i) => parseFeatureBlock(buffer, featureBlocksOffset + (featureIndex + i) * 48)),
    };
  });
  return {
    resref,
    signature: fixedString(buffer, 0, 4),
    version: fixedString(buffer, 4, 4),
    unidentified_name_strref: unidentifiedNameStrref,
    unidentified_name: tlk?.get(unidentifiedNameStrref) ?? null,
    identified_name_strref: identifiedNameStrref,
    identified_name: tlk?.get(identifiedNameStrref) ?? null,
    identified_description_strref: identifiedDescriptionStrref,
    identified_description: tlk?.get(identifiedDescriptionStrref) ?? null,
    flags_raw: buffer.readUInt32LE(0x18),
    item_type: buffer.readUInt16LE(0x1c),
    proficiency_type_raw: buffer.readUInt8(0x31),
    price: buffer.readUInt32LE(0x34),
    stack_amount: buffer.readUInt16LE(0x38),
    weight: buffer.readUInt32LE(0x4c),
    enchantment: buffer.readUInt32LE(0x60),
    equipping_effects: equippingEffects,
    abilities,
  };
}

export function parseSpl(buffer, resref, tlk = null) {
  if (fixedString(buffer, 0, 4) !== "SPL ") throw new Error(`Invalid SPL signature: ${resref}`);
  const nameStrref = buffer.readUInt32LE(0x08);
  const descriptionStrref = buffer.readUInt32LE(0x50);
  return {
    resref,
    signature: fixedString(buffer, 0, 4),
    version: fixedString(buffer, 4, 4),
    name_strref: nameStrref,
    name: tlk?.get(nameStrref) ?? null,
    spell_type: buffer.readUInt16LE(0x1c),
    exclusion_flags_raw: buffer.readUInt32LE(0x1e),
    primary_type_raw: buffer.readUInt8(0x25),
    secondary_type_raw: buffer.readUInt8(0x27),
    spell_level: buffer.readUInt32LE(0x34),
    description_strref: descriptionStrref,
    description: tlk?.get(descriptionStrref) ?? null,
    extended_headers_offset: buffer.readUInt32LE(0x64),
    extended_headers_count: buffer.readUInt16LE(0x68),
  };
}

export function parse2da(buffer, resref = "") {
  const text = decodeEncryptedText(buffer);
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("//"));
  const signatureIndex = lines.findIndex((line) => /^2DA\s+V1\.0/i.test(line));
  if (signatureIndex < 0 || lines.length < signatureIndex + 3) throw new Error(`Invalid 2DA: ${resref}`);
  const defaultValue = lines[signatureIndex + 1].split(/\s+/u)[0];
  const columns = lines[signatureIndex + 2].split(/\s+/u);
  const rows = lines.slice(signatureIndex + 3).map((line) => {
    const parts = line.split(/\s+/u);
    const rowName = parts.shift();
    const values = columns.map((_, i) => parts[i] ?? defaultValue);
    return { row_name: rowName, values, cells: Object.fromEntries(columns.map((column, i) => [column, values[i]])) };
  });
  return { resref, default_value: defaultValue, columns, rows, text };
}

export function decodeEncryptedText(buffer) {
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xff) {
    const key = Buffer.from([0x88,0xa8,0x8f,0xba,0x8a,0xd3,0xb9,0xf5,0xed,0xb1,0xcf,0xea,0xaa,0xe4,0xb5,0xfb,0xeb,0x82,0xf9,0x90,0xca,0xc9,0xb5,0xe7,0xdc,0x8e,0xb7,0xac,0xee,0xf7,0xe0,0xca,0x8e,0xea,0xca,0x80,0xce,0xc5,0xad,0xb7,0xc4,0xd0,0x84,0x93,0xd5,0xf0,0xeb,0xc8,0xb4,0x9d,0xcc,0xaf,0xa5,0x95,0xba,0x99,0x87,0xd2,0x9d,0xe3,0x91,0xba,0x90,0xca]);
    const decoded = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i < buffer.length; i += 1) decoded[i - 2] = buffer[i] ^ key[(i - 2) % key.length];
    text = decoded.toString("utf8");
  } else {
    text = buffer.toString("utf8");
  }
  return text;
}
