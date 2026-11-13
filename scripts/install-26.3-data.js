#!/usr/bin/env node
/**
 * Installs Minecraft Java 26.3 data into the published minecraft-data package.
 *
 * minecraft-data's GitHub repository has no root package.json, so the 26.3
 * protocol data cannot be installed as a GitHub dependency. The published
 * package is installed normally, then this script adds the 26.3 protocol,
 * version metadata, gameplay data, data paths and data.js entry from
 * vendor/minecraft-data.
 *
 * Safe to run repeatedly (npm postinstall after every install / reinstall).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(projectRoot, 'vendor', 'minecraft-data', '26.3');

const MINECRAFT_VERSION = '26.3';
const PROTOCOL_VERSION = 777;
const DATA_VERSION = 5023;
const GAMEPLAY_FILES = [
    'blocks.json',
    'items.json',
    'entities.json',
    'foods.json',
    'recipes.json',
    'blockCollisionShapes.json',
];
const GAMEPLAY_DATA_KEYS = [
    'blocks',
    'items',
    'entities',
    'foods',
    'recipes',
    'blockCollisionShapes',
];
const PLAYER_ACTION_FEATURE = 'playerActionHasChangeDestroyDirection';

function fail(message) {
    throw new Error(`[minecraft 26.3 install] ${message}`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

let packageRoot;
try {
    packageRoot = path.dirname(require.resolve('minecraft-data/package.json'));
} catch {
    packageRoot = path.join(projectRoot, 'node_modules', 'minecraft-data');
}

const dataRoot = path.join(packageRoot, 'minecraft-data');
if (!fs.existsSync(dataRoot)) {
    fail(`minecraft-data is not installed at ${packageRoot}. Run npm install first.`);
}

const pcDataDir = path.join(dataRoot, 'data', 'pc');
const targetDir = path.join(pcDataDir, MINECRAFT_VERSION);
const protocolVersionsFile = path.join(pcDataDir, 'common', 'protocolVersions.json');
const versionsFile = path.join(pcDataDir, 'common', 'versions.json');
const dataPathsFile = path.join(dataRoot, 'data', 'dataPaths.json');
const dataJsFile = path.join(packageRoot, 'data.js');

for (const file of [protocolVersionsFile, versionsFile, dataPathsFile, dataJsFile]) {
    if (!fs.existsSync(file)) {
        fail(`expected minecraft-data file is missing: ${file}`);
    }
}

// 1. Copy the protocol, version metadata, and 26.3 gameplay data. Block
// state IDs and item IDs changed in 26.3; reusing 26.1 data makes oak logs
// decode as spruce logs and corrupts inventory/recipe lookups.
fs.mkdirSync(targetDir, { recursive: true });
for (const file of ['protocol.json', 'version.json', ...GAMEPLAY_FILES]) {
    fs.copyFileSync(path.join(vendorDir, file), path.join(targetDir, file));
}

// 2. Register the protocol version (used by minecraft-data and
// minecraft-protocol for version negotiation and dataVersion lookups).
const protocolVersions = readJson(protocolVersionsFile);
const protocolEntry = {
    minecraftVersion: MINECRAFT_VERSION,
    version: PROTOCOL_VERSION,
    dataVersion: DATA_VERSION,
    usesNetty: true,
    majorVersion: MINECRAFT_VERSION,
    releaseType: 'release',
};
const existingProtocol = protocolVersions.findIndex(entry => entry.minecraftVersion === MINECRAFT_VERSION);
if (existingProtocol >= 0) {
    protocolVersions.splice(existingProtocol, 1);
}
protocolVersions.unshift(protocolEntry);
writeJson(protocolVersionsFile, protocolVersions);

// 3. Add the release to the list of known PC versions.
const versions = readJson(versionsFile);
if (!versions.includes(MINECRAFT_VERSION)) {
    versions.push(MINECRAFT_VERSION);
    writeJson(versionsFile, versions);
}

// 3b. 26.3 inserted CHANGE_DESTROY_DIRECTION at action id 1. Without this
// feature, mineflayer sends old block_dig/use-item action ids and vanilla
// logs destroy-position mismatches.
const featuresFile = path.join(pcDataDir, 'common', 'features.json');
const features = readJson(featuresFile);
if (!features.some(feature => feature.name === PLAYER_ACTION_FEATURE)) {
    features.push({
        name: PLAYER_ACTION_FEATURE,
        description: 'ServerboundPlayerActionPacket inserted CHANGE_DESTROY_DIRECTION at id 1, shifting later actions up by one',
        versions: [MINECRAFT_VERSION, 'latest'],
    });
    writeJson(featuresFile, features);
}

// 4. Point 26.3 at its own protocol, version, and gameplay data. Biomes,
// language, and other data that did not change can still come from 26.1.
const dataPaths = readJson(dataPathsFile);
const basePaths = dataPaths.pc?.['26.1'];
if (!basePaths) {
    fail('minecraft-data has no pc/26.1 data paths to base 26.3 on.');
}
dataPaths.pc[MINECRAFT_VERSION] = {
    ...basePaths,
    protocol: `pc/${MINECRAFT_VERSION}`,
    version: `pc/${MINECRAFT_VERSION}`,
};
for (const key of GAMEPLAY_DATA_KEYS) {
    dataPaths.pc[MINECRAFT_VERSION][key] = `pc/${MINECRAFT_VERSION}`;
}
writeJson(dataPathsFile, dataPaths);

// 5. Add or update the 26.3 loader entry. Cloning the 26.1 block keeps every
// unchanged data path, while protocol, version, and gameplay point at 26.3.
function pointTo263(block) {
    let updated = block;
    for (const file of GAMEPLAY_FILES) {
        updated = updated.replaceAll(`/26.1/${file}`, `/${MINECRAFT_VERSION}/${file}`);
    }
    return updated
        .replaceAll('/26.1/protocol.json', `/${MINECRAFT_VERSION}/protocol.json`)
        .replaceAll('/26.1/version.json', `/${MINECRAFT_VERSION}/version.json`);
}

let dataJs = fs.readFileSync(dataJsFile, 'utf8').replace(/\r\n/g, '\n');
if (!dataJs.includes(`'${MINECRAFT_VERSION}': {`)) {
    const marker = "\n    '26.1': {";
    const start = dataJs.indexOf(marker);
    if (start < 0) {
        fail('could not find the 26.1 entry in minecraft-data/data.js.');
    }
    const blockStart = start + 1;
    // The 26.1 entry may be the last entry in the pc object (closing brace
    // without a comma) or may be followed by more entries (closing brace with
    // a comma). Match the entry's own closing brace, not the next object's.
    const endMatch = /\n    \}(?:,)?/.exec(dataJs.slice(blockStart));
    if (!endMatch) {
        fail('could not find the end of the 26.1 entry in minecraft-data/data.js.');
    }
    const insertAt = blockStart + endMatch.index + endMatch[0].length;
    let block = dataJs.slice(blockStart, insertAt);
    const hadComma = block.trimEnd().endsWith(',');
    let before = dataJs.slice(0, insertAt);
    if (!hadComma) {
        before += ',';
    }
    block = pointTo263(block.replace(`'26.1': {`, `'${MINECRAFT_VERSION}': {`));
    dataJs = `${before}\n${block}${dataJs.slice(insertAt)}`;
} else {
    // Repair installations made before full 26.3 gameplay data was vendored.
    const entryStart = dataJs.indexOf(`    '${MINECRAFT_VERSION}': {`);
    const entryEnd = dataJs.indexOf('\n    }', entryStart);
    if (entryStart < 0 || entryEnd < 0) {
        fail('could not locate the existing 26.3 entry in minecraft-data/data.js.');
    }
    const entry = pointTo263(dataJs.slice(entryStart, entryEnd));
    dataJs = dataJs.slice(0, entryStart) + entry + dataJs.slice(entryEnd);
}
fs.writeFileSync(dataJsFile, dataJs);

// 6. Verify the result the same way the bot will load it at runtime.
const minecraftData = require('minecraft-data');
const data = minecraftData(MINECRAFT_VERSION);
if (!data?.version || data.version.version !== PROTOCOL_VERSION) {
    fail(`minecraft-data did not load ${MINECRAFT_VERSION} (protocol ${PROTOCOL_VERSION}).`);
}
if (!data.protocol?.login?.toClient?.types?.packet_success) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing the login protocol.`);
}
if (!data.blocks || Object.keys(data.blocks).length < 1200) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing 26.3 block data.`);
}
if (!data.items || Object.keys(data.items).length < 1600) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing 26.3 item data.`);
}
if (data.blocksByStateId?.[data.blocksByName?.oak_log?.defaultState]?.name !== 'oak_log') {
    fail(`minecraft-data ${MINECRAFT_VERSION} has an invalid oak_log block-state mapping.`);
}
if (data.itemsByName?.oak_log?.id === undefined) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing the 26.3 oak_log item.`);
}

// 7. Give prismarine-viewer the render data it needs for 26.3. Its bundled
// block states are keyed by block name, so the newest bundled version renders
// 26.3 correctly. The patched viewer accepts 26.3 (see patches/).
const VIEWER_ASSET_SOURCE_VERSION = '1.21.4';
let viewerPublicDir;
try {
    viewerPublicDir = path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public');
} catch {
    // prismarine-viewer is optional; skip its assets when it is not installed.
}
if (viewerPublicDir) {
    const viewerAssets = [
        [path.join('blocksStates', `${VIEWER_ASSET_SOURCE_VERSION}.json`), path.join('blocksStates', `${MINECRAFT_VERSION}.json`)],
        [path.join('textures', `${VIEWER_ASSET_SOURCE_VERSION}.png`), path.join('textures', `${MINECRAFT_VERSION}.png`)],
        [path.join('textures', VIEWER_ASSET_SOURCE_VERSION, 'entity'), path.join('textures', MINECRAFT_VERSION, 'entity')],
    ];
    for (const [source, target] of viewerAssets) {
        const sourcePath = path.join(viewerPublicDir, source);
        const targetPath = path.join(viewerPublicDir, target);
        if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
            continue;
        }
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
}

console.log(`[minecraft 26.3 install] native ${MINECRAFT_VERSION} data ready (protocol ${PROTOCOL_VERSION}, ${Object.keys(data.blocks).length} blocks, ${Object.keys(data.items).length} items).`);
