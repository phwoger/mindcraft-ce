import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { goToPlayer } from '../src/agent/library/skills.js';
import { initializeMcData } from '../src/utils/mcdata.js';

const registry = initializeMcData('26.3');

function makeGoToPlayerBot({ players = {}, target = null } = {}) {
    const bot = {
        username: 'andy',
        entity: { position: new Vec3(0, 0, 0) },
        output: '',
        players,
        registry,
        version: '26.3',
        modes: {
            pause: () => {},
            isOn: () => false,
        },
        pathfinder: {
            getPathTo: async () => ({ status: 'success' }),
            setMovements: () => {},
            goto: async goal => {
                if (target && goal.entity === target) bot.entity.position = target.position.clone();
            },
        },
    };
    return bot;
}

test('goToPlayer reaches a present player', async () => {
    const target = { name: 'Tester', position: new Vec3(5, 0, 0) };
    const bot = makeGoToPlayerBot({ players: { Tester: { entity: target } }, target });

    await goToPlayer(bot, 'Tester', 2);

    assert.equal(bot.entity.position.x, 5);
    assert.match(bot.output, /You have reached Tester\./);
});

test('goToPlayer rejects an unknown player without throwing', async () => {
    const bot = makeGoToPlayerBot({ players: {} });

    assert.equal(await goToPlayer(bot, 'Ghost', 2), false);
    assert.match(bot.output, /Could not find Ghost\./);
});
