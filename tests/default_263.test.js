import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import settings from '../settings.js';
import { isMinecraftVersionSupported } from '../src/utils/minecraft_version.js';

const require = createRequire(import.meta.url);
const protocol = require('minecraft-protocol');
const minecraftData = require('minecraft-data');
const mineflayer = require('mineflayer');
const prismarineChunk = require('prismarine-chunk');

test('default settings target the native 26.3 client', () => {
    assert.equal(settings.minecraft_version, '26.3');
    assert.ok(protocol.supportedVersions.includes('26.3'), 'minecraft-protocol must advertise 26.3');
    assert.equal(isMinecraftVersionSupported(settings.minecraft_version, protocol.supportedVersions), true);
    assert.ok(mineflayer.testedVersions.includes('26.3'), 'mineflayer must list 26.3 as tested');
});

test('26.3 protocol and gameplay data load out of the box', () => {
    const data = minecraftData('26.3');
    assert.equal(data.version.version, 777);
    assert.equal(data.version.minecraftVersion, '26.3');
    assert.ok(data.protocol.login.toClient.types.packet_success);
    assert.ok(Object.keys(data.blocks).length > 0, '26.3 must expose block data');
    assert.ok(Object.keys(data.items).length > 0, '26.3 must expose item data');
});

test('26.3 gameplay data uses 26.3 block-state and item IDs', () => {
    const data = minecraftData('26.3');
    assert.equal(Object.keys(data.blocks).length, 1286);
    assert.equal(Object.keys(data.items).length, 1658);
    assert.equal(data.blocksByName.oak_log.defaultState, 140);
    assert.equal(data.blocksByStateId[140].name, 'oak_log');
    assert.equal(data.blocksByName.spruce_log.defaultState, 143);
    assert.equal(data.itemsByName.oak_log.id, 163);
    assert.equal(data.itemsByName.crafting_table.id, 405);
    assert.equal(data.foodsByName.cooked_beef.foodPoints, 8);
    assert.equal(data.foodsByName.cooked_beef.saturationRatio, 1.6);
});

test('26.3 player-action enum shift is advertised to mineflayer', () => {
    const features = require('minecraft-data/minecraft-data/data/pc/common/features.json');
    const feature = features.find(entry => entry.name === 'playerActionHasChangeDestroyDirection');
    assert.ok(feature, '26.3 player-action feature must be installed');
    assert.ok(feature.versions.includes('26.3'), 'feature must cover 26.3');
});

test('prismarine 26.3 runtime patches are installed', () => {
    assert.doesNotThrow(() => prismarineChunk('26.3'));

    const featuresFile = require.resolve('prismarine-physics/lib/features.json');
    const features = JSON.parse(readFileSync(featuresFile, 'utf8'));
    for (const name of ['proportionalLiquidGravity', 'climbUsingJump']) {
        const feature = features.find(entry => entry.name === name);
        assert.ok(feature, `${name} feature must exist`);
        assert.ok(feature.versions.includes('26.3'), `${name} must include 26.3`);
    }
});
