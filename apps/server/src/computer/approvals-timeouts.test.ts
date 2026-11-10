import { describe, expect, test } from 'bun:test';
import { MCP_REQUEST_TIMEOUT_S } from '../ruimte-mcp.ts';
import { APPROVAL_WAIT_MS, CARD_MS, MAX_HOLD_MS } from './approvals.ts';

// What some agent CLIs give a shell command: ten seconds unless the model asked for more, two minutes at most by default.
const SHELL_COMMAND_FLOOR_MS = 10_000;
const SHELL_COMMAND_CEILING_MS = 120_000;

describe('the waits of a computer use call', () => {
    test('a call holds for a card inside what the shortest CLI gives a shell command, and runs its action after', () => {
        expect(APPROVAL_WAIT_MS).toBeLessThan(SHELL_COMMAND_FLOOR_MS);
    });

    test('the longest hold stays under what a CLI gives a shell command by default', () => {
        expect(MAX_HOLD_MS).toBeLessThan(SHELL_COMMAND_CEILING_MS);
        expect(MAX_HOLD_MS).toBeGreaterThan(APPROVAL_WAIT_MS);
    });

    test('the server lets a tool call hold for a card or a pause and then wait for its window', () => {
        expect(MCP_REQUEST_TIMEOUT_S * 1000).toBeGreaterThanOrEqual(2 * MAX_HOLD_MS);
    });

    test('a card outlasts a hold, so an answer after the call gave up still finds it', () => {
        expect(CARD_MS).toBeGreaterThan(MAX_HOLD_MS);
    });
});
