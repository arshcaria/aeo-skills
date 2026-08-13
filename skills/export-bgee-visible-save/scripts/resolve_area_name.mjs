import path from "node:path";
import { DialogTLK, IEGameResources, RESOURCE_TYPES } from "./ie_game_resources.mjs";

const BALDURS_GATE_CITY_AREAS = new Map([
  ["AR0100", "Northwest Baldur's Gate"],
  ["AR0200", "North Baldur's Gate"],
  ["AR0300", "Northeast Baldur's Gate"],
  ["AR0600", "West Baldur's Gate"],
  ["AR0700", "Central Baldur's Gate"],
  ["AR0800", "East Baldur's Gate"],
  ["AR1100", "Southwest Baldur's Gate"],
  ["AR1200", "South Baldur's Gate"],
  ["AR1300", "Southeast Baldur's Gate"],
]);

const SOD_AREA_NAMES = new Map([
  ["BD0120", "Korlasz's Tomb"],
  ["BD0130", "Korlasz's Tomb"],
]);

function fixedString(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end >= 0 ? end : raw.length).toString("ascii");
}

function usableText(value) {
  const text = value?.trim();
  return text && text !== "<NO TEXT>" ? text : null;
}

export async function resolveAreaName(gameDir, areaResref, language = "en_US", { dlcZipPath = null, cacheDir = null } = {}) {
  const target = String(areaResref || "").toUpperCase();
  if (!target) return null;
  const game = await IEGameResources.open(gameDir, { dlcZipPath, cacheDir });
  const tlk = await DialogTLK.open(await game.dialogTlkPath(language));

  for (const resource of game.list(RESOURCE_TYPES.WMP)) {
    const buffer = await game.get(resource.resref, RESOURCE_TYPES.WMP);
    if (!buffer || fixedString(buffer, 0, 4) !== "WMAP" || fixedString(buffer, 4, 4) !== "V1.0") continue;
    const worldmapCount = buffer.readUInt32LE(0x08);
    const worldmapOffset = buffer.readUInt32LE(0x0c);
    for (let mapIndex = 0; mapIndex < worldmapCount; mapIndex += 1) {
      const mapOffset = worldmapOffset + mapIndex * 184;
      const areaCount = buffer.readUInt32LE(mapOffset + 0x20);
      const areaOffset = buffer.readUInt32LE(mapOffset + 0x24);
      for (let areaIndex = 0; areaIndex < areaCount; areaIndex += 1) {
        const entryOffset = areaOffset + areaIndex * 240;
        const currentArea = fixedString(buffer, entryOffset, 8).toUpperCase();
        const originalArea = fixedString(buffer, entryOffset + 8, 8).toUpperCase();
        if (currentArea !== target && originalArea !== target) continue;
        const nameStrref = buffer.readUInt32LE(entryOffset + 0x40);
        const resolved = usableText(tlk.get(nameStrref));
        if (resolved) return { name: resolved, source: "WMP/TLK" };
      }
    }
  }

  const mapped = BALDURS_GATE_CITY_AREAS.get(target);
  if (mapped) return { name: mapped, source: "BGEE city-area mapping" };
  const sodMapped = SOD_AREA_NAMES.get(target);
  return sodMapped ? { name: sodMapped, source: "SoD area mapping" } : null;
}
