import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { attackNearest } from '../src/agent/library/skills.js';

function makeAttackBot({ target = null } = {}) {
    const entities = {};
    if (target) entities[1] = target;
    const bot = {
        username: 'andy',
        entity: { position: new Vec3(0, 0, 0) },
        entities,
        output: '',
        inventory: { items: () => [] },
        modes: {
            paused: false,
            pause: () => { bot.modes.paused = true; },
        },
        pvp: {
            attack: entity => {
                delete bot.entities[1];
            },
        },
        nearestEntity: () => null,
    };
    return bot;
}

test('attackNearest rejects an empty mob type without pausing modes', async () => {
    const bot = makeAttackBot();

    assert.equal(await attackNearest(bot, ''), false);
    assert.match(bot.output, /Please provide a mob type to attack\./);
    assert.equal(bot.modes.paused, false);
});

test('attackNearest rejects an unknown mob type without attacking', async () => {
    const bot = makeAttackBot();

    assert.equal(await attackNearest(bot, 'ghost'), false);
    assert.match(bot.output, /Could not find any ghost to attack\./);
});

test('attackNearest kills the matching nearby entity and reports success', async () => {
    const target = { name: 'zombie', position: new Vec3(1, 0, 0) };
    const bot = makeAttackBot({ target });

    assert.equal(await attackNearest(bot, 'zombie', true), true);
    assert.equal(bot.entities[1], undefined);
    assert.match(bot.output, /Successfully killed zombie\./);
    assert.match(bot.output, /Picked up 0 items\./);
});
