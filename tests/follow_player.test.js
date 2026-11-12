import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { followPlayer } from '../src/agent/library/skills.js';
import { initializeMcData } from '../src/utils/mcdata.js';

const registry = initializeMcData('26.3');

function makeFollower({ players = {} } = {}) {
    const goals = [];
    const bot = {
        players,
        username: 'andy',
        entity: { position: new Vec3(0, 0, 0) },
        output: '',
        interrupt_code: false,
        registry,
        version: '26.3',
        modes: {
            isOn: () => false,
            pause: () => {},
            unpause: () => {},
        },
        pathfinder: {
            setMovements: () => {},
            setGoal: (goal, dynamic) => goals.push({ goal, dynamic }),
        },
    };
    return { bot, goals };
}

test('followPlayer rejects an unknown player without throwing', async () => {
    const { bot } = makeFollower({ players: {} });

    assert.equal(await followPlayer(bot, 'Ghost', 2), false);
    assert.match(bot.output, /Could not find Ghost\./);
});

test('followPlayer sets a dynamic goal and exits when interrupted', async () => {
    const target = { name: 'Tester', position: new Vec3(5, 0, 0) };
    const { bot, goals } = makeFollower({ players: { Tester: { entity: target } } });

    const following = followPlayer(bot, 'Tester', 2);
    setTimeout(() => { bot.interrupt_code = true; }, 50);

    assert.equal(await following, true);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].dynamic, true);
    assert.equal(goals[0].goal.entity, target);
    assert.match(bot.output, /actively following player Tester\./);
});
