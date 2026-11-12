import test from 'node:test';
import assert from 'node:assert/strict';

import { getCommand, parseCommandMessage } from '../src/agent/commands/index.js';
import { initializeMcData } from '../src/utils/mcdata.js';

initializeMcData('26.3');

test('consume accepts an optional item count', () => {
    const command = getCommand('!consume');
    assert.ok(command, '!consume must be registered');
    assert.equal(command.params.num.optional, true);
});

test('consume parses one item argument', () => {
    const parsed = parseCommandMessage('!consume("cooked_beef")');
    assert.deepEqual(parsed.args, ['cooked_beef']);
});

test('consume parses an item and count', () => {
    const parsed = parseCommandMessage('!consume("cooked_beef", 2)');
    assert.deepEqual(parsed.args, ['cooked_beef', 2]);
});

test('consume rejects zero or too many arguments', () => {
    assert.match(parseCommandMessage('!consume()'), /requires 1-2 args/);
    assert.match(parseCommandMessage('!consume("cooked_beef", 1, 2)'), /requires 1-2 args/);
});
