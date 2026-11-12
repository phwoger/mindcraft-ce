import test from 'node:test';
import assert from 'node:assert/strict';

import { getCommand } from '../src/agent/commands/index.js';

test('consume accepts an optional item count', () => {
    const command = getCommand('!consume');
    assert.ok(command, '!consume must be registered');
    assert.equal(command.params.num.optional, true);
});
