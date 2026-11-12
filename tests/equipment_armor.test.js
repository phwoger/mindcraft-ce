import test from 'node:test';
import assert from 'node:assert/strict';

import { equip } from '../src/agent/library/skills.js';
import { getInventoryCounts } from '../src/agent/library/world.js';

function makeEquipmentBot({ slots = {} } = {}) {
    const inventorySlots = [];
    for (const [index, item] of Object.entries(slots)) inventorySlots[Number(index)] = item;
    const equipped = {};
    const bot = {
        output: '',
        game: { gameMode: 'survival' },
        inventory: { slots: inventorySlots, findInventoryItem: () => null },
        async equip(item, destination) {
            const index = inventorySlots.indexOf(item);
            if (index !== -1) inventorySlots[index] = null;
            equipped[destination] = { ...item };
        },
        async unequip() {},
    };
    return { bot, equipped };
}

function item(name, count = 1) {
    return { name, count, type: 1 };
}

test('inventory counts exclude equipped armor slots', () => {
    const { bot } = makeEquipmentBot({
        slots: {
            0: item('oak_log', 2),
            5: item('iron_helmet'),
            6: item('iron_chestplate'),
            36: item('stone', 3),
        },
    });

    assert.deepEqual(getInventoryCounts(bot), { oak_log: 2, stone: 3 });
});

test('equip moves armor out of inventory and into the head slot', async () => {
    const helmet = item('iron_helmet');
    const { bot, equipped } = makeEquipmentBot({ slots: { 0: helmet } });

    assert.equal(await equip(bot, 'iron_helmet'), true);
    assert.deepEqual(equipped, { head: helmet });
    assert.deepEqual(getInventoryCounts(bot), {});
    assert.match(bot.output, /Equipped iron_helmet\./);
});

test('equip rejects a missing item without crashing', async () => {
    const { bot } = makeEquipmentBot();

    assert.equal(await equip(bot, 'diamond_helmet'), false);
    assert.deepEqual(getInventoryCounts(bot), {});
    assert.match(bot.output, /do not have any diamond_helmet to equip\./);
});
