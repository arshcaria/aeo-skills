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
const result = {
  source_file: path.basename(savPath),
  signature: "SAV V1.0",
  archive_entry_count: files.length,
  store_count: stores.length,
  stores,
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  archive_entries: files.length,
  stores: stores.length,
  store_items: stores.reduce((sum, store) => sum + store.items.length, 0),
}, null, 2));
