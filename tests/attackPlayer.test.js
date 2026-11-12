import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { getCommand, parseCommandMessage } from '../src/agent/commands/index.js';

function makePlayerAttackBot({ players = {}, target = null } = {}) {
    const entities = {};
    if (target) entities[1] = target;
    const pvpCalls = [];
    const bot = {
        username: 'andy',
        entity: { position: new Vec3(0, 0, 0) },
        entities,
        players,
        output: '',
        inventory: { items: () => [] },
        modes: { pause: () => {} },
        nearestEntity: () => null,
        pvp: {
            attack(entity) {
                pvpCalls.push(entity);
                for (const player of Object.values(players)) {
                    if (player.entity === entity) player.entity = null;
                }
                delete bot.entities[1];
            },
        },
    };
    return { bot, pvpCalls };
}

function makeAgent(bot) {
    return {
        bot,
        actions: {
            async runAction(_label, actionFn) {
                await actionFn();
                return { interrupted: false, timedout: false, message: 'ok' };
            },
        },
    };
}

test('attackPlayer declares one required string player argument', () => {
    const command = getCommand('!attackPlayer');

    assert.ok(command, '!attackPlayer must be registered');
    assert.equal(command.params.player_name.type, 'string');
    assert.notEqual(command.params.player_name.optional, true);
});

test('attackPlayer parses a target and rejects a missing target', () => {
    assert.deepEqual(parseCommandMessage('!attackPlayer("Target")'), {
        commandName: '!attackPlayer',
        args: ['Target'],
    });
    assert.match(parseCommandMessage('!attackPlayer()'), /requires 1 args/);
});

test('attackPlayer rejects an empty player name without attacking', async () => {
    const { bot, pvpCalls } = makePlayerAttackBot();
    const action = getCommand('!attackPlayer');

    assert.equal(await action.perform(makeAgent(bot), ''), 'ok');
    assert.match(bot.output, /Please provide a player name to attack\./);
    assert.deepEqual(pvpCalls, []);
});

test('attackPlayer rejects an unknown player without attacking', async () => {
    const { bot, pvpCalls } = makePlayerAttackBot();
    const action = getCommand('!attackPlayer');

    assert.equal(await action.perform(makeAgent(bot), 'Ghost'), 'ok');
    assert.match(bot.output, /Could not find player Ghost\./);
    assert.deepEqual(pvpCalls, []);
});

test('attackPlayer kills the named player and reports the player name', async () => {
    const target = { name: 'player', username: 'Target', position: new Vec3(0, 0, 0) };
    const players = { Target: { entity: target } };
    const { bot, pvpCalls } = makePlayerAttackBot({ players, target });
    const action = getCommand('!attackPlayer');

    assert.equal(await action.perform(makeAgent(bot), 'Target'), 'ok');
    assert.deepEqual(pvpCalls, [target]);
    assert.equal(players.Target.entity, null);
    assert.match(bot.output, /Successfully killed Target\./);
    assert.match(bot.output, /Picked up 0 items\./);
});
