import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { initializeMcData } from '../src/utils/mcdata.js';

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

const registry = initializeMcData('1.21.8');

function makeModeAgent(runAction, enemies = [], activeMode = 'self_defense', botOverrides = {}) {
    const bot = {
        entity: { position: new Vec3(0, 0, 0) },
        entities: Object.fromEntries(enemies.map((enemy, index) => [index, enemy])),
        registry,
        inventory: {
            items: () => [],
            findInventoryItem: () => null,
            emptySlotCount: () => 0,
        },
        blockAt: () => ({ name: 'air' }),
        findBlocks: () => [],
        clearControlStates: () => {},
        setControlState: () => {},
        targetDigBlock: null,
        lastDamageTime: 0,
        lastDamageTaken: 0,
        health: 20,
        nearestEntity(predicate) {
            return enemies.find(enemy => predicate(enemy)) || null;
        },
        pathfinder: {
            getPathTo: async () => ({ status: 'success' }),
        },
        ...botOverrides,
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
    modes.setOn(activeMode, true);
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

        await updateMode(agent);
        assert.equal(attempts, 1);
        await updateMode(agent);
        assert.equal(attempts, 2);
        assert.equal(unhandled.length, 0);

        secondResolve({ success: true, message: 'done', interrupted: false });
        await settle();
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

function makeModeAnimal() {
    return { name: 'cow', type: 'animal', metadata: {}, position: new Vec3(2, 0, 0) };
}

function makeModePlayer() {
    return { name: 'Tester', type: 'player', metadata: {}, position: new Vec3(0.2, 0, 0) };
}

function makeModeItem(x) {
    return { name: 'item', type: 'object', metadata: {}, position: new Vec3(x, 0, 0) };
}

function makeRejectingTask(modeName) {
    let starts = 0;
    return {
        get starts() {
            return starts;
        },
        runAction() {
            starts++;
            return Promise.reject(new Error(`${modeName} task failed`));
        },
    };
}

async function updateMode(agent) {
    await agent.bot.modes.update();
    await settle();
}

test('self_defense recovers after two consecutive rejected tasks', async () => {
    let attempts = 0;
    let agent;
    agent = makeModeAgent(() => {
        attempts++;
        agent.bot.modes.pause('self_defense');
        if (attempts <= 2) {
            return Promise.reject(new Error('defense exploded'));
        }
        return Promise.resolve({ success: true, message: 'done', interrupted: false });
    }, [makeModeEnemy()]);

    await updateMode(agent);
    assert.equal(attempts, 1);
    await updateMode(agent);
    assert.equal(attempts, 2);
    await updateMode(agent);
    assert.equal(attempts, 3);
});

test('self_preservation returns to idle and resumable after a rejected task', async () => {
    const task = makeRejectingTask('self_preservation');
    const agent = makeModeAgent(task.runAction, [], 'self_preservation', {
        blockAt: () => ({ name: 'fire' }),
    });

    await updateMode(agent);
    assert.equal(task.starts, 1);
    await updateMode(agent);
    assert.equal(task.starts, 2);
});

test('unstuck returns to idle and resumable after a rejected task', async () => {
    const realNow = Date.now;
    let now = realNow() + 100000;
    Date.now = () => now;
    try {
        const task = makeRejectingTask('unstuck');
        const agent = makeModeAgent(task.runAction, [], 'unstuck');
        agent.isIdle = () => false;

        await updateMode(agent);
        now += 21000;
        await updateMode(agent);
        assert.equal(task.starts, 1);
        now += 21000;
        await updateMode(agent);
        assert.equal(task.starts, 2);
    } finally {
        Date.now = realNow;
    }
});

test('cowardice returns to idle and resumable after a rejected task', async () => {
    const task = makeRejectingTask('cowardice');
    const agent = makeModeAgent(task.runAction, [makeModeEnemy()], 'cowardice');

    await updateMode(agent);
    assert.equal(task.starts, 1);
    await updateMode(agent);
    assert.equal(task.starts, 2);
});

test('hunting returns to idle and resumable after a rejected task', async () => {
    const task = makeRejectingTask('hunting');
    const agent = makeModeAgent(task.runAction, [makeModeAnimal()], 'hunting');

    await updateMode(agent);
    assert.equal(task.starts, 1);
    await updateMode(agent);
    assert.equal(task.starts, 2);
});

test('item_collecting returns to idle and resumable after a rejected task', async () => {
    const realNow = Date.now;
    let now = realNow() + 100000;
    Date.now = () => now;
    try {
        const task = makeRejectingTask('item_collecting');
        const items = [makeModeItem(2)];
        const agent = makeModeAgent(task.runAction, items, 'item_collecting', {
            inventory: { items: () => [], findInventoryItem: () => null, emptySlotCount: () => 2 },
        });

        await updateMode(agent);
        now += 2100;
        await updateMode(agent);
        assert.equal(task.starts, 1);

        items[0] = makeModeItem(2.2);
        await updateMode(agent);
        now += 2100;
        await updateMode(agent);
        assert.equal(task.starts, 2);
    } finally {
        Date.now = realNow;
    }
});

test('torch_placing returns to idle and resumable after a rejected task', async () => {
    const realNow = Date.now;
    let now = realNow() + 100000;
    Date.now = () => now;
    try {
        const task = makeRejectingTask('torch_placing');
        const agent = makeModeAgent(task.runAction, [], 'torch_placing', {
            inventory: {
                items: () => [],
                findInventoryItem: () => ({ name: 'torch' }),
                emptySlotCount: () => 36,
            },
        });

        await updateMode(agent);
        assert.equal(task.starts, 1);
        now += 6000;
        await updateMode(agent);
        assert.equal(task.starts, 2);
    } finally {
        Date.now = realNow;
    }
});

test('elbow_room returns to idle and resumable after a rejected task', async () => {
    const task = makeRejectingTask('elbow_room');
    const agent = makeModeAgent(task.runAction, [makeModePlayer()], 'elbow_room');

    await updateMode(agent);
    assert.equal(task.starts, 1);
    await updateMode(agent);
    assert.equal(task.starts, 2);
});
