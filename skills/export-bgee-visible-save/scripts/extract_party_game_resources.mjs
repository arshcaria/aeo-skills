import fs from "node:fs/promises";
import path from "node:path";
import { DialogTLK, IEGameResources, RESOURCE_TYPES, parse2da, parseItm, parseSpl } from "./ie_game_resources.mjs";

const gameDir = process.argv[2];
const rawJsonPath = process.argv[3];
const outputDir = process.argv[4];
const language = process.argv[5] || "en_US";
const campaign = process.argv[6] || "Baldur's Gate: Enhanced Edition";
const dlcZipPath = process.argv[7] || null;
if (!gameDir || !rawJsonPath || !outputDir) throw new Error("Usage: node extract_party_game_resources.mjs <game_dir> <raw_json> <output_dir> [language] [campaign] [dlc_zip]");

const raw = JSON.parse(await fs.readFile(rawJsonPath, "utf8"));
const game = await IEGameResources.open(gameDir, {
  dlcZipPath,
  cacheDir: path.join(outputDir, "dlc_cache"),
});
const dialogTlkPath = await game.dialogTlkPath(language);
const tlk = await DialogTLK.open(dialogTlkPath);
const itemResrefs = [...new Set(raw.party_members.flatMap((member) => member.embedded_cre_record.items.map((item) => item.resref.toUpperCase())))].sort();
const spellResrefs = [...new Set(raw.party_members.flatMap((member) => [
  ...member.embedded_cre_record.known_spells.map((spell) => spell.resref.toUpperCase()),
  ...member.embedded_cre_record.memorized_spells.map((spell) => spell.resref.toUpperCase()),
]))].sort();

await fs.mkdir(path.join(outputDir, "2da"), { recursive: true });
await fs.mkdir(path.join(outputDir, "itm"), { recursive: true });
await fs.mkdir(path.join(outputDir, "spl"), { recursive: true });

const requiredTwoDa = [
  "DEXMOD", "SKILLDEX", "SKILLRAC", "LOREBON", "MXSPLWIS", "WSPECIAL",
  "WSPATCK", "RACETHAC", "STRMOD", "STYLBONU", "KITLIST",
];
const twoDaIndex = [];
for (const resref of requiredTwoDa) {
  const buffer = await game.get(resref, RESOURCE_TYPES.TWO_DA);
  if (!buffer) throw new Error(`Missing required 2DA resource: ${resref}`);
  const parsed = parse2da(buffer, resref);
  await fs.writeFile(path.join(outputDir, "2da", `${resref}.2da`), parsed.text, "utf8");
  twoDaIndex.push({ resref, columns: parsed.columns, rows: parsed.rows.length });
}

const items = [];
for (const resref of itemResrefs) {
  const buffer = await game.get(resref, RESOURCE_TYPES.ITM);
  if (!buffer) {
    items.push({ resref, missing: true });
    continue;
  }
  await fs.writeFile(path.join(outputDir, "itm", `${resref}.ITM`), buffer);
  items.push(parseItm(buffer, resref, tlk));
}

const spells = [];
for (const resref of spellResrefs) {
  const buffer = await game.get(resref, RESOURCE_TYPES.SPL);
  if (!buffer) {
    spells.push({ resref, missing: true });
    continue;
  }
  await fs.writeFile(path.join(outputDir, "spl", `${resref}.SPL`), buffer);
  spells.push(parseSpl(buffer, resref, tlk));
}

const result = {
  game_directory: gameDir,
  language,
  campaign,
  dialog_tlk_path: dialogTlkPath,
  resource_layers: game.layers.map((layer) => layer.name),
  key_resource_count: game.resources.length,
  bif_count: game.bifs.length,
  two_da_count: twoDaIndex.length,
  item_resref_count: itemResrefs.length,
  spell_resref_count: spellResrefs.length,
  missing_items: items.filter((item) => item.missing).map((item) => item.resref),
  missing_spells: spells.filter((spell) => spell.missing).map((spell) => spell.resref),
  two_da_index: twoDaIndex,
  items,
  spells,
};
await fs.writeFile(path.join(outputDir, "party_game_resources.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.join(outputDir, "party_game_resources.json"),
  key_resource_count: result.key_resource_count,
  two_da_count: result.two_da_count,
  item_resref_count: result.item_resref_count,
  spell_resref_count: result.spell_resref_count,
  missing_items: result.missing_items,
  missing_spells: result.missing_spells,
  resource_layers: result.resource_layers,
}, null, 2));
