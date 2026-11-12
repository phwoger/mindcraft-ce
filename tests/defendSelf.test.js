import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { defendSelf } from '../src/agent/library/skills.js';

function makeDefenseBot(enemies = []) {
    let index = 0;
    const bot = {
        entity: { position: new Vec3(0, 0, 0) },
        inventory: { items: () => [] },
        output: '',
        interrupt_code: false,
        modes: {
            paused: [],
            pause(name) { this.paused.push(name); },
        },
        pvp: {
            attacks: [],
            stopCalls: 0,
            attack(enemy) {
                this.attacks.push(enemy);
                index++;
            },
            stop() { this.stopCalls++; },
        },
        pathfinder: {
            setMovements: () => {},
            goto: async () => {},
        },
        nearestEntity: () => enemies[index] || null,
    };
    return bot;
}

test('defendSelf reports no enemies without attacking', async () => {
    const bot = makeDefenseBot();

    assert.equal(await defendSelf(bot, 8), false);
    assert.match(bot.output, /No enemies nearby to defend self from\./);
    assert.equal(bot.pvp.attacks.length, 0);
    assert.equal(bot.pvp.stopCalls, 1);
    assert.deepEqual(bot.modes.paused, ['self_defense', 'cowardice']);
});

test('defendSelf ignores a hostile outside its range', async () => {
    const enemy = { name: 'zombie', position: new Vec3(10, 0, 0) };
    const bot = makeDefenseBot([enemy]);
    bot.nearestEntity = predicate => predicate(enemy) && bot.entity.position.distanceTo(enemy.position) < 8 ? enemy : null;

    assert.equal(await defendSelf(bot, 8), false);
    assert.equal(bot.pvp.attacks.length, 0);
    assert.match(bot.output, /No enemies nearby to defend self from\./);
});

test('defendSelf attacks every hostile in range and reports success', async () => {
    const enemies = [
        { name: 'zombie', position: new Vec3(3, 0, 0) },
        { name: 'zombie', position: new Vec3(3, 0, 0) },
    ];
    const bot = makeDefenseBot(enemies);

    assert.equal(await defendSelf(bot, 8), true);
    assert.deepEqual(bot.pvp.attacks, enemies);
    assert.equal(bot.pvp.stopCalls, 1);
    assert.match(bot.output, /Successfully defended self\./);
});

test('defendSelf stops cleanly when interrupted', async () => {
    const enemy = { name: 'zombie', position: new Vec3(3, 0, 0) };
    const bot = makeDefenseBot([enemy]);
    bot.pvp.attack = function () {
        bot.interrupt_code = true;
    };

    assert.equal(await defendSelf(bot, 8), false);
    assert.equal(bot.pvp.stopCalls, 1);
    assert.doesNotMatch(bot.output, /Successfully defended self\./);
});
