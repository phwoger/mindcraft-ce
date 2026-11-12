import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { collectBlock, craftRecipe, smeltItem } from '../src/agent/library/skills.js';
import { getCommand } from '../src/agent/commands/index.js';
import { getBlockId, getItemId, initializeMcData } from '../src/utils/mcdata.js';

const registry = initializeMcData('26.3');

const PLANKS = getItemId('oak_planks');
const LOG = getItemId('oak_log');
const CHEST = getItemId('chest');
const CRAFTING_TABLE = getBlockId('crafting_table');
const RAW_IRON = getItemId('raw_iron');
const IRON_INGOT = getItemId('iron_ingot');
const COAL = getItemId('coal');

function makeInventory(entries) {
    const slots = entries.map(([name, count]) => ({ name, count, type: getItemId(name) }));
    const find = name => slots.find(slot => slot?.name === name);
    const bot = {
        output: '',
        inventory: {
            slots,
            items: () => slots.filter(Boolean),
            findInventoryItem: name => find(name) || null,
        },
        entity: { position: new Vec3(0, 0, 0) },
    };
    function add(name, count) {
        const existing = find(name);
        if (existing) existing.count += count;
        else slots.push({ name, count, type: getItemId(name) });
    }
    function remove(name, count) {
        const existing = find(name);
        if (!existing) return false;
        existing.count -= count;
        if (existing.count <= 0) slots.splice(slots.indexOf(existing), 1);
        return true;
    }
    function counts() {
        return Object.fromEntries(slots.filter(Boolean).map(slot => [slot.name, slot.count]));
    }
    return { bot, slots, add, remove, counts };
}

function makeCrafter(entries) {
    const inventory = makeInventory(entries);
    const { bot } = inventory;
    const recipe = {
        inShape: [[{ id: LOG, count: 1 }]],
        result: { id: PLANKS, count: 4 },
    };
    const craftCalls = [];
    bot.recipesFor = itemId => {
        if (itemId !== PLANKS || !inventory.slots.some(slot => slot?.name === 'oak_log')) return [];
        return [recipe];
    };
    bot.craft = async (_recipe, count) => {
        craftCalls.push(count);
        inventory.remove('oak_log', count);
        inventory.add('oak_planks', count * 4);
    };
    bot.armorManager = { equipAll() {} };
    return { bot, craftCalls, counts: inventory.counts };
}

function makeTableCrafter(entries, { noFreeSpace = false, placementFails = false } = {}) {
    const inventory = makeInventory(entries);
    const { bot } = inventory;
    const recipe = {
        inShape: [
            [{ id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }],
            [{ id: PLANKS, count: 1 }, { id: -1, count: 1 }, { id: PLANKS, count: 1 }],
            [{ id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }, { id: PLANKS, count: 1 }],
        ],
        result: { id: CHEST, count: 1 },
    };
    const craftCalls = [];
    bot.recipesFor = (itemId, _metadata, _min, table) => {
        if (itemId !== CHEST || !table) return [];
        if (!inventory.slots.some(slot => slot?.name === 'oak_planks' && slot.count >= 8)) return [];
        return [recipe];
    };
    bot.craft = async (_recipe, count, table) => {
        craftCalls.push({ count, table });
        inventory.remove('oak_planks', count * 8);
        inventory.add('chest', count);
    };
    bot.armorManager = { equipAll() {} };
    bot.equip = async () => {};
    bot.lookAt = async () => {};
    bot.modes = { isOn: () => false, pause() {} };
    bot.game = { gameMode: 'survival' };
    bot.registry = registry;
    bot.version = '26.3';
    bot.tool = { equipForBlock: async () => {} };

    const key = position => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
    const air = position => ({ name: 'air', type: getBlockId('air'), position: new Vec3(position.x, position.y, position.z), shapes: [], drops: [], diggable: false });
    const table = position => ({ name: 'crafting_table', type: CRAFTING_TABLE, position: new Vec3(position.x, position.y, position.z), shapes: [], drops: [], diggable: true, canHarvest: () => true });
    const blocks = new Map();
    const airPosition = new Vec3(2, 0, 0);
    const supportPosition = new Vec3(2, -1, 0);
    if (!noFreeSpace) blocks.set(key(airPosition), air(airPosition));
    blocks.set(key(supportPosition), { name: 'stone', type: getBlockId('stone'), position: supportPosition, shapes: [], drops: [CRAFTING_TABLE], diggable: true });
    bot.blockAt = position => blocks.get(key(position)) || air(position);
    bot.findBlocks = ({ matching, count = 1000 }) => {
        const matches = block => typeof matching === 'function' ? matching(block) :
            Array.isArray(matching) ? matching.includes(block.type) : block.type === matching;
        return [...blocks.values()].filter(matches).slice(0, count).map(block => block.position);
    };

    let placed = 0;
    let collected = 0;
    bot.placeBlock = async (buildOffBlock, face) => {
        if (placementFails) throw new Error('placement blocked');
        const position = buildOffBlock.position.offset(face.x, face.y, face.z);
        blocks.set(key(position), table(position));
        inventory.remove('crafting_table', 1);
        placed++;
    };
    bot.collectBlock = {
        async collect(block) {
            if (blocks.get(key(block.position))?.name !== 'crafting_table')
                throw new Error('no placed crafting table to collect');
            blocks.delete(key(block.position));
            inventory.add('crafting_table', 1);
            collected++;
        },
    };

    return {
        bot, craftCalls, counts: inventory.counts,
        tableCount: () => [...blocks.values()].filter(block => block.name === 'crafting_table').length,
        placedCount: () => placed,
        collectedCount: () => collected,
    };
}

function makeCollector(entries, { count = 1, failure = false } = {}) {
    const inventory = makeInventory(entries);
    const { bot } = inventory;
    const key = position => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
    const blocks = new Map();
    for (let i = 0; i < count; i++) {
        const position = new Vec3(i + 1, 0, 0);
        blocks.set(key(position), {
            name: 'oak_log', type: getBlockId('oak_log'), position,
            drops: [LOG], diggable: true, canHarvest: () => true,
        });
    }
    const collectCalls = [];
    bot.entity = { position: new Vec3(0, 0, 0) };
    bot.heldItem = null;
    bot.modes = { isOn: () => false };
    bot.registry = registry;
    bot.version = '26.3';
    bot.tool = { equipForBlock: async () => {} };
    bot.blockAt = position => blocks.get(key(position)) || null;
    bot.findBlocks = () => [...blocks.values()].map(block => block.position);
    bot.collectBlock = {
        async collect(block) {
            collectCalls.push(block.name);
            if (failure) throw new Error('drop was not picked up');
            blocks.delete(key(block.position));
            inventory.add('oak_log', 1);
        },
    };
    return {
        bot, collectCalls, counts: inventory.counts,
        blockCount: () => blocks.size,
    };
}

function makeFurnaceBot(entries) {
    const inventory = makeInventory(entries);
    const { bot } = inventory;
    const furnaceBlock = { name: 'furnace', position: new Vec3(1, 0, 0) };
    const calls = [];
    const furnace = {
        output: null,
        inputItem() { return null; },
        fuelItem() { return null; },
        outputItem() { return this.output; },
        async putFuel(type, _metadata, count) {
            calls.push({ slot: 'fuel', type, count });
            inventory.remove('coal', count);
            this.output = null;
        },
        async putInput(type, _metadata, count) {
            calls.push({ slot: 'input', type, count });
            inventory.remove('raw_iron', count);
            this.output = { type: IRON_INGOT, count };
        },
        async takeOutput() {
            const output = this.output;
            this.output = null;
            inventory.add('iron_ingot', output.count);
            return { type: output.type, count: output.count, name: 'iron_ingot' };
        },
        async takeInput() {},
        async takeFuel() {},
    };
    bot.findBlocks = () => [furnaceBlock.position];
    bot.blockAt = () => furnaceBlock;
    bot.openFurnace = async () => furnace;
    bot.closeWindow = async () => {};
    bot.lookAt = async () => {};
    bot.modes = { pause() {} };
    return { bot, furnace, calls, counts: inventory.counts };
}

test('crafting consumes the right raw materials and yields multiple outputs', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts } = makeCrafter([['oak_log', 4]]);

    assert.equal(await craftRecipe(bot, 'oak_planks', 2), true);
    assert.deepEqual(craftCalls, [2]);
    assert.deepEqual(counts(), { oak_log: 2, oak_planks: 8 });
});

test('crafting rejects insufficient materials without crafting', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts } = makeCrafter([['oak_log', 1]]);

    assert.equal(await craftRecipe(bot, 'oak_planks', 2), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), { oak_log: 1 });
});

test('crafting rejects missing materials', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts } = makeCrafter([]);

    assert.equal(await craftRecipe(bot, 'oak_planks', 1), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), {});
});

test('a table recipe places a table, crafts, and restores the table', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts, tableCount, placedCount, collectedCount } = makeTableCrafter([
        ['oak_planks', 8],
        ['crafting_table', 1],
    ]);

    assert.equal(await craftRecipe(bot, 'chest', 1), true);
    assert.equal(craftCalls.length, 1);
    assert.equal(craftCalls[0].count, 1);
    assert.equal(craftCalls[0].table.name, 'crafting_table');
    assert.deepEqual(counts(), { crafting_table: 1, chest: 1 });
    assert.equal(placedCount(), 1);
    assert.equal(collectedCount(), 1);
    assert.equal(tableCount(), 0);
});

test('a table recipe with no free space rejects without losing materials', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts, tableCount, placedCount, collectedCount } = makeTableCrafter([
        ['oak_planks', 8],
        ['crafting_table', 1],
    ], { noFreeSpace: true });

    assert.equal(await craftRecipe(bot, 'chest', 1), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), { oak_planks: 8, crafting_table: 1 });
    assert.equal(placedCount(), 0);
    assert.equal(collectedCount(), 0);
    assert.equal(tableCount(), 0);
});

test('a table placement failure rejects without crafting or losing the table', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts, tableCount, placedCount, collectedCount } = makeTableCrafter([
        ['oak_planks', 8],
        ['crafting_table', 1],
    ], { placementFails: true });

    assert.equal(await craftRecipe(bot, 'chest', 1), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), { oak_planks: 8, crafting_table: 1 });
    assert.equal(placedCount(), 0);
    assert.equal(collectedCount(), 0);
    assert.equal(tableCount(), 0);
});

test('a table recipe without a table is rejected', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts, tableCount } = makeTableCrafter([['oak_planks', 8]]);

    assert.equal(await craftRecipe(bot, 'chest', 1), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), { oak_planks: 8 });
    assert.equal(tableCount(), 0);
});

test('an insufficient table recipe rejects and removes the placed table', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, craftCalls, counts, tableCount, placedCount, collectedCount } = makeTableCrafter([
        ['oak_planks', 8],
        ['crafting_table', 1],
    ]);

    assert.equal(await craftRecipe(bot, 'chest', 2), false);
    assert.deepEqual(craftCalls, []);
    assert.deepEqual(counts(), { oak_planks: 8, crafting_table: 1 });
    assert.equal(placedCount(), 1);
    assert.equal(collectedCount(), 1);
    assert.equal(tableCount(), 0);
});

test('collectBlock removes blocks and picks up their drops', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, collectCalls, counts, blockCount } = makeCollector([], { count: 2 });

    assert.equal(await collectBlock(bot, 'oak_log', 2), true);
    assert.deepEqual(collectCalls, ['oak_log', 'oak_log']);
    assert.deepEqual(counts(), { oak_log: 2 });
    assert.equal(blockCount(), 0);
    assert.match(bot.output, /Collected 2 oak_log\./);
});

test('collectBlock rejects when the drop cannot be collected', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, collectCalls, counts, blockCount } = makeCollector([], { failure: true });

    assert.equal(await collectBlock(bot, 'oak_log', 1), false);
    assert.deepEqual(collectCalls, ['oak_log']);
    assert.deepEqual(counts(), {});
    assert.equal(blockCount(), 1);
    assert.match(bot.output, /Collected 0 oak_log\./);
});

test('smelting chooses coal, consumes input, and yields an ingot', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, calls, counts } = makeFurnaceBot([
        ['raw_iron', 2],
        ['coal', 2],
        ['oak_planks', 2],
    ]);

    assert.equal(await smeltItem(bot, 'raw_iron', 1), true);
    assert.deepEqual(calls, [
        { slot: 'fuel', type: COAL, count: 1 },
        { slot: 'input', type: RAW_IRON, count: 1 },
    ]);
    assert.deepEqual(counts(), { raw_iron: 1, coal: 1, oak_planks: 2, iron_ingot: 1 });
});

test('smelting rejects missing fuel and insufficient input', async t => {
    t.mock.method(console, 'log', () => {});

    const withoutFuel = makeFurnaceBot([['raw_iron', 1]]);
    assert.equal(await smeltItem(withoutFuel.bot, 'raw_iron', 1), false);
    assert.deepEqual(withoutFuel.calls, []);
    assert.deepEqual(withoutFuel.counts(), { raw_iron: 1 });

    const insufficientInput = makeFurnaceBot([['raw_iron', 1], ['coal', 2]]);
    assert.equal(await smeltItem(insufficientInput.bot, 'raw_iron', 2), false);
    assert.deepEqual(insufficientInput.calls, []);
    assert.deepEqual(insufficientInput.counts(), { raw_iron: 1, coal: 2 });
});

test('the smelt command requests a restart after successful smelting', async t => {
    t.mock.method(console, 'log', () => {});
    const { bot, counts } = makeFurnaceBot([['raw_iron', 1], ['coal', 1]]);
    const kills = [];
    const agent = {
        bot,
        cleanKill(message) { kills.push(message); },
        actions: {
            async runAction(_label, actionFn) {
                await actionFn();
                return { interrupted: false, timedout: false, message: 'ok' };
            },
        },
    };
    const action = getCommand('!smeltItem');

    assert.equal(await action.perform(agent, 'raw_iron', 1), 'ok');
    assert.deepEqual(counts(), { iron_ingot: 1 });
    assert.deepEqual(kills, []);
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.deepEqual(kills, ['Safely restarting to update inventory.']);
});
