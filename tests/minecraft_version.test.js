import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareMinecraftVersions,
    isMinecraftVersionSupported,
    newestMinecraftVersion,
    parseMinecraftVersion,
} from '../src/utils/minecraft_version.js';

test('parses both 1.x and year-based Minecraft versions', () => {
    assert.deepEqual(parseMinecraftVersion('26.3'), { major: 26, minor: 3, patch: 0 });
    assert.deepEqual(parseMinecraftVersion('1.21.11'), { major: 1, minor: 21, patch: 11 });
    assert.equal(parseMinecraftVersion('auto'), null);
});

test('orders year-based versions after 1.x versions', () => {
    assert.ok(compareMinecraftVersions('26.3', '26.1') > 0);
    assert.ok(compareMinecraftVersions('26.1', '1.21.11') > 0);
    assert.ok(compareMinecraftVersions('1.21.11', '1.21.1') > 0);
    assert.equal(compareMinecraftVersions('26.3', '26.3'), 0);
});

test('matches supported versions including patch releases', () => {
    assert.equal(isMinecraftVersionSupported('26.1', ['1.21.11', '26.1']), true);
    assert.equal(isMinecraftVersionSupported('26.1.1', ['26.1']), true);
    assert.equal(isMinecraftVersionSupported('26.3', ['1.21.11', '26.1']), false);
    assert.equal(isMinecraftVersionSupported('1.21.11', ['1.21.1']), false);
});

test('finds the newest version in a mixed list', () => {
    assert.equal(newestMinecraftVersion(['1.21.11', '26.1', '1.21.6']), '26.1');
    assert.equal(newestMinecraftVersion([]), null);
});
