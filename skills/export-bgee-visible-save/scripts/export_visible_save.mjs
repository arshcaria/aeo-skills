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
    "  --game-dir <path>    BGEE installation containing chitin.key",
    "  --save-root <path>   Save directory; defaults to the Windows Documents BGEE save folder",
    "  --save <path>        Specific save directory, BALDUR.gam, or save ZIP",
    "  --output-dir <path>  Output directory; defaults to outputs/latest_save_<timestamp>",
    "  --language <code>    Installed game language used for visible strings (default: en_US)",
    "  --area-name <text>   Player-visible area name override for areas absent from WORLDMAP.WMP",
    "  --help               Show this message",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") options.help = true;
    else if (["--game-dir", "--save-root", "--save", "--output-dir", "--language", "--area-name"].includes(token)) {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${token}`);
      options[token.slice(2).replaceAll("-", "_")] = argv[index += 1];
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
    process.env.BGEE_GAME_DIR,
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Baldur's Gate Enhanced Edition",
    "C:\\Program Files\\Steam\\steamapps\\common\\Baldur's Gate Enhanced Edition",
    "C:\\GOG Games\\Baldur's Gate - Enhanced Edition",
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "chitin.key"))) return candidate;
  }
  throw new Error("BGEE installation not found. Pass --game-dir or set BGEE_GAME_DIR.");
}

async function saveCandidate(savePath) {
  const resolved = path.resolve(savePath);
  const info = await fs.stat(resolved);
  if (info.isDirectory()) {
    const gamPath = await findCaseInsensitiveFile(resolved, "BALDUR.gam");
    if (!gamPath) throw new Error(`No BALDUR.gam in save directory: ${resolved}`);
    const gamInfo = await fs.stat(gamPath);
    return { sourcePath: resolved, gamPath, zipPath: null, modifiedMs: gamInfo.mtimeMs, displayName: visibleSaveName(path.basename(resolved)) };
  }
  if (path.extname(resolved).toLowerCase() === ".zip") {
    return { sourcePath: resolved, gamPath: null, zipPath: resolved, modifiedMs: info.mtimeMs, displayName: visibleSaveName(path.basename(resolved, path.extname(resolved))) };
  }
  if (path.basename(resolved).toLowerCase() === "baldur.gam") {
    return { sourcePath: resolved, gamPath: resolved, zipPath: null, modifiedMs: info.mtimeMs, displayName: visibleSaveName(path.basename(path.dirname(resolved))) };
  }
  throw new Error(`Unsupported save path: ${resolved}`);
}

async function findLatestSave(saveRoot) {
  const root = path.resolve(saveRoot);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !(entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))) continue;
    try {
      candidates.push(await saveCandidate(path.join(root, entry.name)));
    } catch (error) {
      if (!String(error.message).startsWith("No BALDUR.gam")) throw error;
    }
  }
  candidates.sort((a, b) => b.modifiedMs - a.modifiedMs);
  if (!candidates.length) throw new Error(`No BGEE saves found in ${root}`);
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

async function extractGam(zipPath, stagingDir) {
  const entry = listArchive(zipPath).find((candidate) => /(^|\/)BALDUR\.GAM$/iu.test(candidate));
  if (!entry) throw new Error(`BALDUR.GAM not found in ${zipPath}`);
  const normalized = entry.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..") || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Unsafe BALDUR.GAM archive path: ${entry}`);
  }
  await fs.mkdir(stagingDir, { recursive: true });
  const result = spawnSync("tar", ["-xf", zipPath, "-C", stagingDir, entry], { stdio: "inherit" });
  if (result.error) throw new Error(`Unable to extract ZIP with tar: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to extract BALDUR.GAM from ${zipPath}`);
  return path.join(stagingDir, ...normalized.split("/"));
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

const runTimestamp = timestamp();
const gameDir = await detectGameDir(options.game_dir);
const defaultSaveRoot = path.join(os.homedir(), "Documents", "Baldur's Gate - Enhanced Edition", "save");
const selectedSave = options.save ? await saveCandidate(options.save) : await findLatestSave(options.save_root || defaultSaveRoot);
const outputDir = path.resolve(options.output_dir || path.join(process.cwd(), "outputs", `latest_save_${runTimestamp}`));
const resourcesDir = path.join(outputDir, "resources");
const rawJsonPath = path.join(outputDir, `BGEE_team_raw_${runTimestamp}.json`);
const outputCsvPath = path.join(outputDir, `BGEE_team_player_visible_${runTimestamp}.csv`);
const language = options.language || "en_US";
await fs.mkdir(resourcesDir, { recursive: true });
if (await exists(rawJsonPath) || await exists(outputCsvPath)) {
  throw new Error(`Refusing to overwrite an existing timestamped export in ${outputDir}`);
}

const gamPath = selectedSave.gamPath || await extractGam(selectedSave.zipPath, path.join(resourcesDir, "source_save"));
runNode("export_bgee_raw_json.mjs", [gamPath, rawJsonPath, ...(selectedSave.zipPath ? [selectedSave.zipPath] : [])]);
runNode("validate_bgee_raw_json.mjs", [gamPath, rawJsonPath, ...(selectedSave.zipPath ? [selectedSave.zipPath] : [])]);
runNode("extract_party_game_resources.mjs", [gameDir, rawJsonPath, resourcesDir, language]);

const raw = JSON.parse(await fs.readFile(rawJsonPath, "utf8"));
const extractedResources = JSON.parse(await fs.readFile(path.join(resourcesDir, "party_game_resources.json"), "utf8"));
if (extractedResources.missing_items.length || extractedResources.missing_spells.length) {
  throw new Error(`Missing installed resources: items=${extractedResources.missing_items.join("|") || "none"}; spells=${extractedResources.missing_spells.join("|") || "none"}`);
}
const resolvedArea = options.area_name
  ? { name: options.area_name, source: "command-line override" }
  : await resolveAreaName(gameDir, raw.game_header.current_area_resref, language);
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
  game_directory: gameDir,
  language,
  current_area: resolvedArea?.name || "Unknown Area",
  current_area_source: resolvedArea?.source || "unresolved",
  raw_json: rawJsonPath,
  visible_csv: outputCsvPath,
}, null, 2));
