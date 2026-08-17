import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const [savPath, outputPath] = process.argv.slice(2);
if (!savPath || !outputPath) {
  throw new Error("Usage: node parse_baldur_sav.mjs <BALDUR.SAV> <output.json>");
}

function fixedString(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString("latin1").replace(/\0.*$/u, "");
}

function assertRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`${label} is outside the source buffer: offset=${offset}; length=${length}; size=${buffer.length}`);
  }
}

function parseSto(buffer, fileName) {
  const signature = fixedString(buffer, 0, 4);
  const version = fixedString(buffer, 4, 4);
  if (signature !== "STOR" || !["V1.0", "V1.1", "V9.0"].includes(version)) {
    throw new Error(`Unsupported STO signature/version in ${fileName}: ${signature} ${version}`);
  }
  if (buffer.length < 0x9c) throw new Error(`Truncated STO header in ${fileName}`);
  const itemsOffset = buffer.readUInt32LE(0x34);
  const itemsCount = buffer.readUInt32LE(0x38);
  const entrySize = version === "V9.0" ? 0x58 : 0x1c;
  assertRange(buffer, itemsOffset, itemsCount * entrySize, `${fileName} sale items`);
  const items = Array.from({ length: itemsCount }, (_, index) => {
    const offset = itemsOffset + index * entrySize;
    return {
      resref: fixedString(buffer, offset, 8).toUpperCase(),
      expiration_time_raw: buffer.readUInt16LE(offset + 0x08),
      charge_1_or_quantity_raw: buffer.readUInt16LE(offset + 0x0a),
      charge_2_raw: buffer.readUInt16LE(offset + 0x0c),
      charge_3_raw: buffer.readUInt16LE(offset + 0x0e),
      flags_raw: buffer.readUInt32LE(offset + 0x10),
      amount_in_stock_raw: buffer.readUInt32LE(offset + 0x14),
      infinite_supply_raw: buffer.readUInt32LE(offset + 0x18),
    };
  });
  return {
    resref: path.basename(fileName, path.extname(fileName)).toUpperCase(),
    file_name: path.basename(fileName),
    signature,
    version,
    items,
  };
}

const PLAYER_CHEST_NAME = "PLAYERCHEST00";
const PLAYER_CHEST_STAGE_ORDER = new Map([
  ["BD0103", 1],
  ["BD1000", 2],
  ["BD7100", 3],
  ["BD3000", 4],
]);

function parseArePlayerChests(buffer, fileName) {
  const signature = fixedString(buffer, 0, 4);
  const version = fixedString(buffer, 4, 4);
  if (signature !== "AREA" || version !== "V1.0") {
    throw new Error(`Unsupported ARE signature/version in ${fileName}: ${signature} ${version}`);
  }
  if (buffer.length < 0x100) throw new Error(`Truncated ARE header in ${fileName}`);

  const containersOffset = buffer.readUInt32LE(0x70);
  const containersCount = buffer.readUInt16LE(0x74);
  const itemsCount = buffer.readUInt16LE(0x76);
  const itemsOffset = buffer.readUInt32LE(0x78);
  const containerSize = 0xc0;
  const itemSize = 0x14;
  assertRange(buffer, containersOffset, containersCount * containerSize, `${fileName} containers`);
  assertRange(buffer, itemsOffset, itemsCount * itemSize, `${fileName} items`);

  const areaResref = path.basename(fileName, path.extname(fileName)).toUpperCase();
  const areaLastSavedRaw = buffer.readUInt32LE(0x10);
  const chests = [];
  for (let index = 0; index < containersCount; index += 1) {
    const containerOffset = containersOffset + index * containerSize;
    const containerName = fixedString(buffer, containerOffset, 32);
    if (containerName.toUpperCase() !== PLAYER_CHEST_NAME) continue;

    const firstItemIndex = buffer.readUInt32LE(containerOffset + 0x40);
    const containerItemsCount = buffer.readUInt32LE(containerOffset + 0x44);
    if (firstItemIndex > itemsCount || containerItemsCount > itemsCount - firstItemIndex) {
      throw new Error(`Invalid item range for ${containerName} in ${fileName}: first=${firstItemIndex}; count=${containerItemsCount}; area_items=${itemsCount}`);
    }
    const items = Array.from({ length: containerItemsCount }, (_, itemIndex) => {
      const offset = itemsOffset + (firstItemIndex + itemIndex) * itemSize;
      const resref = fixedString(buffer, offset, 8).toUpperCase();
      if (!resref) throw new Error(`Empty item resref in ${containerName} in ${fileName} at index ${itemIndex}`);
      return {
        resref,
        expiration_time_raw: buffer.readUInt16LE(offset + 0x08),
        charge_1_or_quantity_raw: buffer.readUInt16LE(offset + 0x0a),
        charge_2_raw: buffer.readUInt16LE(offset + 0x0c),
        charge_3_raw: buffer.readUInt16LE(offset + 0x0e),
        flags_raw: buffer.readUInt32LE(offset + 0x10),
      };
    });
    chests.push({
      area_resref: areaResref,
      file_name: path.basename(fileName),
      area_last_saved_raw: areaLastSavedRaw,
      container_name: containerName,
      container_index_raw: index,
      items,
    });
  }
  return chests;
}

function selectPlayerChest(candidates) {
  return [...candidates].sort((left, right) => (
    right.area_last_saved_raw - left.area_last_saved_raw
    || (PLAYER_CHEST_STAGE_ORDER.get(right.area_resref) || 0) - (PLAYER_CHEST_STAGE_ORDER.get(left.area_resref) || 0)
    || right.items.length - left.items.length
    || left.area_resref.localeCompare(right.area_resref)
  ))[0] || null;
}

function parseSav(buffer) {
  const signature = fixedString(buffer, 0, 8);
  if (signature !== "SAV V1.0") throw new Error(`Unsupported SAV signature: ${signature}`);
  const files = [];
  let offset = 8;
  while (offset < buffer.length) {
    assertRange(buffer, offset, 4, "SAV filename length");
    const nameLength = buffer.readUInt32LE(offset);
    offset += 4;
    assertRange(buffer, offset, nameLength + 8, "SAV entry header");
    const fileName = fixedString(buffer, offset, nameLength);
    offset += nameLength;
    const uncompressedSize = buffer.readUInt32LE(offset);
    const compressedSize = buffer.readUInt32LE(offset + 4);
    offset += 8;
    assertRange(buffer, offset, compressedSize, `SAV compressed entry ${fileName}`);
    const data = zlib.inflateSync(buffer.subarray(offset, offset + compressedSize));
    offset += compressedSize;
    if (data.length !== uncompressedSize) {
      throw new Error(`SAV size mismatch for ${fileName}: expected=${uncompressedSize}; actual=${data.length}`);
    }
    files.push({ fileName, data, uncompressedSize, compressedSize });
  }
  return files;
}

const sav = await fs.readFile(savPath);
const files = parseSav(sav);
const stores = files
  .filter(({ fileName }) => fileName.toLowerCase().endsWith(".sto"))
  .map(({ fileName, data }) => parseSto(data, fileName));
const playerChestCandidates = files
  .filter(({ fileName }) => fileName.toLowerCase().endsWith(".are"))
  .flatMap(({ fileName, data }) => parseArePlayerChests(data, fileName));
const playerChest = selectPlayerChest(playerChestCandidates);
const result = {
  source_file: path.basename(savPath),
  signature: "SAV V1.0",
  archive_entry_count: files.length,
  store_count: stores.length,
  stores,
  player_chest_candidate_count: playerChestCandidates.length,
  player_chest_candidates: playerChestCandidates,
  player_chest: playerChest,
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  archive_entries: files.length,
  stores: stores.length,
  store_items: stores.reduce((sum, store) => sum + store.items.length, 0),
  player_chest_candidates: playerChestCandidates.length,
  player_chest_area: playerChest?.area_resref || null,
  player_chest_items: playerChest?.items.length || 0,
}, null, 2));
