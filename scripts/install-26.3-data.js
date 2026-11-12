#!/usr/bin/env node
/**
 * Installs Minecraft Java 26.3 data into the published minecraft-data package.
 *
 * minecraft-data's GitHub repository has no root package.json, so the 26.3
 * protocol data cannot be installed as a GitHub dependency. The published
 * package is installed normally, then this script adds the 26.3 protocol,
 * version metadata, data paths and data.js entry from vendor/minecraft-data.
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

// 1. Copy the protocol and version metadata.
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(path.join(vendorDir, 'protocol.json'), path.join(targetDir, 'protocol.json'));
fs.copyFileSync(path.join(vendorDir, 'version.json'), path.join(targetDir, 'version.json'));

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

// 4. Point 26.3 at its own protocol/version, and reuse 26.1 gameplay data
// (blocks, items, biomes, etc.) until minecraft-data publishes full 26.3 data.
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
writeJson(dataPathsFile, dataPaths);

// 5. Add the 26.3 loader entry. Cloning the 26.1 block keeps every gameplay
// data path, while protocol/version point at the vendored 26.3 files.
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
    block = block
        .replace(`'26.1': {`, `'${MINECRAFT_VERSION}': {`)
        .replaceAll('/26.1/protocol.json', `/${MINECRAFT_VERSION}/protocol.json`)
        .replaceAll('/26.1/version.json', `/${MINECRAFT_VERSION}/version.json`);
    dataJs = `${before}\n${block}${dataJs.slice(insertAt)}`;
    fs.writeFileSync(dataJsFile, dataJs);
}

// 6. Verify the result the same way the bot will load it at runtime.
const minecraftData = require('minecraft-data');
const data = minecraftData(MINECRAFT_VERSION);
if (!data?.version || data.version.version !== PROTOCOL_VERSION) {
    fail(`minecraft-data did not load ${MINECRAFT_VERSION} (protocol ${PROTOCOL_VERSION}).`);
}
if (!data.protocol?.login?.toClient?.types?.packet_success) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing the login protocol.`);
}
if (!data.blocks || Object.keys(data.blocks).length === 0) {
    fail(`minecraft-data ${MINECRAFT_VERSION} is missing gameplay data.`);
}

console.log(`[minecraft 26.3 install] native ${MINECRAFT_VERSION} data ready (protocol ${PROTOCOL_VERSION}, ${Object.keys(data.blocks).length} blocks).`);
