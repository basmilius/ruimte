import { describe, expect, test } from 'bun:test';
import { behaviorOf, rawCanvasKeyHandlers, rawKeyHandlers } from '@/commands/behavior';
import { installWorkspaceCommands } from './workspace-commands';

describe('installWorkspaceCommands', () => {
    test('refuses to register a behavior twice outside a dev server', () => {
        expect(() => installWorkspaceCommands(false)).toThrow(/has two behaviors/);
    });

    test('under a dev server that replaces modules it runs again over the first run without doubling anything', () => {
        const behavior = behaviorOf('panel-toggle');
        const keys = rawKeyHandlers().length;
        const canvasKeys = rawCanvasKeyHandlers().length;

        expect(behavior).toBeDefined();
        expect(keys).toBeGreaterThan(0);

        installWorkspaceCommands(true);

        expect(behaviorOf('panel-toggle')).toBe(behavior);
        expect(rawKeyHandlers()).toHaveLength(keys);
        expect(rawCanvasKeyHandlers()).toHaveLength(canvasKeys);
    });
});
