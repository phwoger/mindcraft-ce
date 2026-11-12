import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';

import { craftRecipe, smeltItem } from '../src/agent/library/skills.js';
import { getCommand } from '../src/agent/commands/index.js';
import { getItemId, initializeMcData } from '../src/utils/mcdata.js';

initializeMcData('26.3');

const PLANKS = getItemId('oak_planks');
const LOG = getItemId('oak_log');
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
