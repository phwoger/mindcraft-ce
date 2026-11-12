import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLimitingResource, WOOD_TYPES } from '../src/utils/mcdata.js';

test('a missing ingredient limits crafting to zero', () => {
    const result = calculateLimitingResource({ oak_log: 3 }, { oak_log: 1, stick: 2 });
    assert.equal(result.num, 0);
    assert.equal(result.limitingResource, 'stick');
});

test('the scarcest ingredient is reported', () => {
    const result = calculateLimitingResource({ oak_log: 4, stick: 4 }, { oak_log: 1, stick: 2 });
    assert.equal(result.num, 2);
    assert.equal(result.limitingResource, 'stick');
});

test('26.3 poplar wood is part of the known wood types', () => {
    assert.ok(WOOD_TYPES.includes('poplar'));
});
