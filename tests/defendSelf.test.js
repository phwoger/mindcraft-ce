import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import mcData from 'minecraft-data';

import { defendSelf } from '../src/agent/library/skills.js';
import { initModes } from '../src/agent/modes.js';

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

const registry = mcData('1.21.8');

function makeModeAgent(runAction, enemies = []) {
    const bot = {
        entity: { position: new Vec3(0, 0, 0) },
        entities: Object.fromEntries(enemies.map((enemy, index) => [index, enemy])),
        registry,
        nearestEntity(predicate) {
            return enemies.find(enemy => predicate(enemy)) || null;
        },
        pathfinder: {
            getPathTo: async () => ({ status: 'success' }),
        },
    };
    const agent = {
        bot,
        shut_up: true,
        prompter: { getInitModes: () => null },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        actions: {
            currentActionLabel: '',
            resume_func: null,
            executing: false,
            runAction,
        },
        isIdle: () => true,
        openChat: () => {},
        handleMessage: () => {},
    };
    initModes(agent);
    const modes = agent.bot.modes;
    for (const name of Object.keys(modes.getJson())) {
        modes.setOn(name, false);
    }
    modes.setOn('self_defense', true);
    return agent;
}

function makeModeEnemy() {
    return { name: 'zombie', type: 'mob', metadata: {}, position: new Vec3(2, 0, 0) };
}

function deferredActions() {
    const calls = [];
    return {
        calls,
        runAction(label, actionFn, options) {
            return new Promise((resolve, reject) => {
                calls.push({ label, actionFn, options, resolve, reject });
            });
        },
    };
}

async function settle() {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
}

test('self_defense holds active until the defense task completes and clears it', async () => {
    const actions = deferredActions();
    const agent = makeModeAgent(actions.runAction, [makeModeEnemy()]);

    await agent.bot.modes.update();
    assert.equal(actions.calls.length, 1);
    assert.equal(actions.calls[0].label, 'mode:self_defense');

    await agent.bot.modes.update();
    assert.equal(actions.calls.length, 1);

    actions.calls[0].resolve({ success: true, message: 'done', interrupted: false });
    await settle();

    await agent.bot.modes.update();
    assert.equal(actions.calls.length, 2);
    actions.calls[1].resolve({ success: true, message: 'done', interrupted: false });
    await settle();
});

test('self_defense re-entry starts only one defense and the original completes', async () => {
    const actions = deferredActions();
    const agent = makeModeAgent(actions.runAction, [makeModeEnemy()]);

    await agent.bot.modes.update();
    await agent.bot.modes.update();
    assert.equal(actions.calls.length, 1);

    actions.calls[0].resolve({ success: true, message: 'done', interrupted: false });
    await settle();
    assert.equal(agent.bot.modes.flushBehaviorLog().trim(), 'Fighting zombie!');
});

test('self_defense does not start or report success with no hostiles', async () => {
    let starts = 0;
    const agent = makeModeAgent(() => {
        starts++;
        return Promise.resolve({ success: true, message: 'done', interrupted: false });
    });

    await agent.bot.modes.update();
    await settle();
    assert.equal(starts, 0);
    assert.equal(agent.bot.modes.flushBehaviorLog(), '');

    await agent.bot.modes.update();
    assert.equal(starts, 0);
});

test('self_defense clears active when the skill reports false and remains resumable', async () => {
    let starts = 0;
    let agent;
    agent = makeModeAgent(() => {
        starts++;
        agent.bot.modes.pause('self_defense');
        return Promise.resolve({ success: false, message: 'No enemies', interrupted: false });
    }, [makeModeEnemy()]);

    await agent.bot.modes.update();
    await settle();
    assert.equal(starts, 1);
    assert.match(agent.bot.modes.behavior_log, /Fighting zombie!/);
    assert.doesNotMatch(agent.bot.modes.behavior_log, /Successfully defended self\./);

    await agent.bot.modes.update();
    assert.equal(starts, 2);
    await settle();
});

test('self_defense clears active and resumes after a rejected defense task', async () => {
    let attempts = 0;
    let secondResolve;
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
        let agent;
        agent = makeModeAgent(() => {
            attempts++;
            agent.bot.modes.pause('self_defense');
            if (attempts === 1) {
                return Promise.reject(new Error('defense exploded'));
            }
            return new Promise(resolve => { secondResolve = resolve; });
        }, [makeModeEnemy()]);

        await agent.bot.modes.update();
        await settle();
        await agent.bot.modes.update();

        assert.equal(attempts, 2);
        assert.equal(unhandled.length, 0);

        secondResolve({ success: true, message: 'done', interrupted: false });
        await settle();
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});
