import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveAreaName } from "./resolve_area_name.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return [
    "Usage: node export_visible_save.mjs [options]",
    "",
    "Options:",
    "  --game-dir <path>    BGEE/SoD or EET installation containing chitin.key",
    "  --save-root <path>   Save directory; repeatable; defaults depend on the detected installation",
    "  --save <path>        Specific save directory, BALDUR.gam, or save ZIP",
    "  --dlc-zip <path>     Standalone SoD DLC archive; EET uses its integrated resources",
    "  --output-dir <path>  Output directory; defaults to outputs/latest_save_<timestamp>",
    "  --language <code>    Installed game language used for visible strings (default: en_US)",
    "  --area-name <text>   Player-visible area name override for areas absent from WORLDMAP.WMP",
    "  --help               Show this message",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { save_roots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") options.help = true;
    else if (["--game-dir", "--save-root", "--save", "--dlc-zip", "--output-dir", "--language", "--area-name"].includes(token)) {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${token}`);
      const value = argv[index += 1];
      if (token === "--save-root") options.save_roots.push(value);
      else options[token.slice(2).replaceAll("-", "_")] = value;
    } else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function timestamp(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectInstallationType(gameDir) {
  const engineLuaPath = path.join(gameDir, "engine.lua");
  try {
    const engineLua = await fs.readFile(engineLuaPath, "utf8");
    if (/Baldur's Gate\s*-\s*Enhanced Edition Trilogy/iu.test(engineLua)) return "EET";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (await exists(path.join(gameDir, "EET")) && await exists(path.join(gameDir, "EET_end"))) return "EET";
  return "BGEE";
}

function campaignProfile(installationType, currentCampaign) {
  const stage = String(currentCampaign || "").trim().toUpperCase();
  if (installationType === "EET") {
    const profiles = {
      BG1: { stage: "BG1", tag: "EET_BG1", name: "Baldur's Gate: Enhanced Edition Trilogy - BG1" },
      SOD: { stage: "SOD", tag: "EET_SOD", name: "Baldur's Gate: Enhanced Edition Trilogy - Siege of Dragonspear" },
      SOA: { stage: "SOA", tag: "EET_SOA", name: "Baldur's Gate: Enhanced Edition Trilogy - Shadows of Amn" },
      BG2: { stage: "SOA", tag: "EET_SOA", name: "Baldur's Gate: Enhanced Edition Trilogy - Shadows of Amn" },
      BG2EE: { stage: "SOA", tag: "EET_SOA", name: "Baldur's Gate: Enhanced Edition Trilogy - Shadows of Amn" },
      TOB: { stage: "TOB", tag: "EET_TOB", name: "Baldur's Gate: Enhanced Edition Trilogy - Throne of Bhaal" },
    };
    const profile = profiles[stage];
    if (!profile) throw new Error(`Unsupported EET campaign identifier: ${stage || "<empty>"}`);
    return profile;
  }
  return stage === "SOD"
    ? { stage: "SOD", tag: "SOD", name: "Siege of Dragonspear" }
    : { stage: "BGEE", tag: "BGEE", name: "Baldur's Gate: Enhanced Edition" };
}

async function findCaseInsensitiveFile(directory, fileName) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase());
  return match ? path.join(directory, match.name) : null;
}

function visibleSaveName(fileName) {
  return fileName.replace(/^\d{9}-/u, "");
}

async function detectGameDir(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.EET_GAME_DIR,
    process.env.BGEE_GAME_DIR,
    "C:\\Games\\EET-2.6.6\\build\\BG2EE-EET",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Baldur's Gate Enhanced Edition",
    "C:\\Program Files\\Steam\\steamapps\\common\\Baldur's Gate Enhanced Edition",
    "C:\\GOG Games\\Baldur's Gate - Enhanced Edition",
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "chitin.key"))) return candidate;
  }
  throw new Error("BGEE/SoD or EET installation not found. Pass --game-dir, set EET_GAME_DIR, or set BGEE_GAME_DIR.");
}

async function saveCandidate(savePath) {
  const resolved = path.resolve(savePath);
  const info = await fs.stat(resolved);
  if (info.isDirectory()) {
    const gamPath = await findCaseInsensitiveFile(resolved, "BALDUR.gam");
    if (!gamPath) throw new Error(`No BALDUR.gam in save directory: ${resolved}`);
    const savPath = await findCaseInsensitiveFile(resolved, "BALDUR.SAV");
    const gamInfo = await fs.stat(gamPath);
    return { sourcePath: resolved, gamPath, savPath, zipPath: null, modifiedMs: gamInfo.mtimeMs, displayName: visibleSaveName(path.basename(resolved)) };
  }
  if (path.extname(resolved).toLowerCase() === ".zip") {
    return { sourcePath: resolved, gamPath: null, savPath: null, zipPath: resolved, modifiedMs: info.mtimeMs, displayName: visibleSaveName(path.basename(resolved, path.extname(resolved))) };
  }
  if (path.basename(resolved).toLowerCase() === "baldur.gam") {
    const savPath = await findCaseInsensitiveFile(path.dirname(resolved), "BALDUR.SAV");
    return { sourcePath: resolved, gamPath: resolved, savPath, zipPath: null, modifiedMs: info.mtimeMs, displayName: visibleSaveName(path.basename(path.dirname(resolved))) };
  }
  throw new Error(`Unsupported save path: ${resolved}`);
}

async function findLatestSave(saveRoots) {
  const candidates = [];
  for (const saveRoot of saveRoots) {
    const root = path.resolve(saveRoot);
    if (!(await exists(root))) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !(entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))) continue;
      try {
        candidates.push(await saveCandidate(path.join(root, entry.name)));
      } catch (error) {
        if (!String(error.message).startsWith("No BALDUR.gam")) throw error;
      }
    }
  }
  candidates.sort((a, b) => b.modifiedMs - a.modifiedMs);
  if (!candidates.length) throw new Error(`No BGEE or SoD saves found in: ${saveRoots.map((root) => path.resolve(root)).join(", ")}`);
  return candidates[0];
}

function runNode(scriptName, args) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, scriptName), ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${scriptName} failed with exit code ${result.status}`);
}

function listArchive(zipPath) {
  const result = spawnSync("tar", ["-tf", zipPath], { encoding: "utf8" });
  if (result.error) throw new Error(`Unable to inspect ZIP with tar: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to inspect ZIP: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

async function extractArchiveFile(zipPath, stagingDir, fileName, required = true) {
  const entry = listArchive(zipPath).find((candidate) => new RegExp(`(^|/)${fileName.replace(".", "\\.")}$`, "iu").test(candidate));
  if (!entry) {
    if (required) throw new Error(`${fileName} not found in ${zipPath}`);
    return null;
  }
  const normalized = entry.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..") || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Unsafe ${fileName} archive path: ${entry}`);
  }
  await fs.mkdir(stagingDir, { recursive: true });
  const result = spawnSync("tar", ["-xf", zipPath, "-C", stagingDir, entry], { stdio: "inherit" });
  if (result.error) throw new Error(`Unable to extract ZIP with tar: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to extract ${fileName} from ${zipPath}`);
  return path.join(stagingDir, ...normalized.split("/"));
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

const runTimestamp = timestamp();
const gameDir = await detectGameDir(options.game_dir);
const installationType = await detectInstallationType(gameDir);
if (installationType === "EET" && options.dlc_zip) {
  throw new Error("--dlc-zip is not valid for EET; use the integrated EET chitin.key, override, and dialog.tlk resources");
}
const documentsRoot = path.join(
  os.homedir(),
  "Documents",
  installationType === "EET" ? "Baldur's Gate - Enhanced Edition Trilogy" : "Baldur's Gate - Enhanced Edition",
);
const defaultSaveRoots = installationType === "EET"
  ? [path.join(documentsRoot, "save")]
  : [path.join(documentsRoot, "save"), path.join(documentsRoot, "sodsave")];
const selectedSave = options.save ? await saveCandidate(options.save) : await findLatestSave(options.save_roots.length ? options.save_roots : defaultSaveRoots);
const outputDir = path.resolve(options.output_dir || path.join(process.cwd(), "outputs", `latest_save_${runTimestamp}`));
const resourcesDir = path.join(outputDir, "resources");
const provisionalRawJsonPath = path.join(outputDir, `.team_raw_${runTimestamp}.json`);
const language = options.language || "en_US";
await fs.mkdir(resourcesDir, { recursive: true });

const stagingDir = path.join(resourcesDir, "source_save");
const gamPath = selectedSave.gamPath || await extractArchiveFile(selectedSave.zipPath, stagingDir, "BALDUR.GAM");
const savPath = selectedSave.savPath || (selectedSave.zipPath ? await extractArchiveFile(selectedSave.zipPath, stagingDir, "BALDUR.SAV", false) : null);
runNode("export_bgee_raw_json.mjs", [gamPath, provisionalRawJsonPath, ...(selectedSave.zipPath ? [selectedSave.zipPath] : [])]);
runNode("validate_bgee_raw_json.mjs", [gamPath, provisionalRawJsonPath, ...(selectedSave.zipPath ? [selectedSave.zipPath] : [])]);

const raw = JSON.parse(await fs.readFile(provisionalRawJsonPath, "utf8"));
const campaign = campaignProfile(installationType, raw.game_header.current_campaign);
const isSod = campaign.stage === "SOD";
raw.export_context = {
  installation_type: installationType,
  campaign_stage: campaign.stage,
  campaign_tag: campaign.tag,
  campaign_name: campaign.name,
};
const containerDataPath = path.join(resourcesDir, "container_stores.json");
let parsedContainerData = {
  source_available: false,
  stores: [],
  player_chest_candidate_count: 0,
  player_chest_candidates: [],
  player_chest: null,
};
if (savPath) {
  runNode("parse_baldur_sav.mjs", [savPath, containerDataPath]);
  parsedContainerData = JSON.parse(await fs.readFile(containerDataPath, "utf8"));
  parsedContainerData.source_available = true;
}
const heldItemResrefs = new Set(raw.party_members.flatMap((member) => member.embedded_cre_record.items.map((item) => item.resref.toUpperCase())));
raw.container_source_available = parsedContainerData.source_available;
raw.container_stores = parsedContainerData.stores.filter((store) => heldItemResrefs.has(store.resref));
if (isSod) {
  raw.sod_party_chest_source_available = parsedContainerData.source_available;
  raw.sod_party_chest_candidates_count = parsedContainerData.player_chest_candidate_count;
  raw.sod_party_chest = parsedContainerData.player_chest;
}
const campaignTag = campaign.tag;
const campaignName = campaign.name;
const rawJsonPath = path.join(outputDir, `${campaignTag}_team_raw_${runTimestamp}.json`);
const outputCsvPath = path.join(outputDir, `${campaignTag}_team_player_visible_${runTimestamp}.csv`);
if (await exists(rawJsonPath) || await exists(outputCsvPath)) throw new Error(`Refusing to overwrite an existing timestamped export in ${outputDir}`);
await fs.writeFile(rawJsonPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
await fs.unlink(provisionalRawJsonPath);

const defaultDlcZip = path.join(gameDir, "dlc", "sod-dlc.zip");
const dlcZipPath = isSod && installationType !== "EET" ? path.resolve(options.dlc_zip || defaultDlcZip) : null;
if (dlcZipPath && !(await exists(dlcZipPath))) throw new Error(`SoD DLC archive not found: ${dlcZipPath}`);
runNode("extract_party_game_resources.mjs", [
  gameDir, rawJsonPath, resourcesDir, language, campaignName, dlcZipPath || "", installationType,
]);

const extractedResources = JSON.parse(await fs.readFile(path.join(resourcesDir, "party_game_resources.json"), "utf8"));
if (extractedResources.missing_items.length || extractedResources.missing_spells.length) {
  throw new Error(`Missing installed resources: items=${extractedResources.missing_items.join("|") || "none"}; spells=${extractedResources.missing_spells.join("|") || "none"}`);
}
const resolvedArea = options.area_name
  ? { name: options.area_name, source: "command-line override" }
  : await resolveAreaName(gameDir, raw.game_header.current_area_resref, language, {
    dlcZipPath,
    cacheDir: path.join(resourcesDir, "dlc_cache"),
    baseLayerName: installationType === "EET" ? "eet-integrated" : "base",
  });
runNode("build_player_visible_export.mjs", [
  rawJsonPath,
  path.join(resourcesDir, "party_game_resources.json"),
  outputCsvPath,
  selectedSave.displayName,
  resolvedArea?.name || "Unknown Area",
  language,
]);

console.log(JSON.stringify({
  save: selectedSave.sourcePath,
  installation_type: installationType,
  campaign_stage: campaign.stage,
  campaign: campaignName,
  game_directory: gameDir,
  language,
  current_area: resolvedArea?.name || "Unknown Area",
  current_area_source: resolvedArea?.source || "unresolved",
  container_stores: raw.container_stores.length,
  container_items: raw.container_stores.reduce((sum, store) => sum + store.items.length, 0),
  ...(isSod ? {
    party_chest_found: Boolean(raw.sod_party_chest),
    party_chest_items: raw.sod_party_chest?.items.length || 0,
  } : {}),
  raw_json: rawJsonPath,
  visible_csv: outputCsvPath,
}, null, 2));
