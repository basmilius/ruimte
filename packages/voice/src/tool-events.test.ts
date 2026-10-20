import { describe, expect, test } from 'bun:test';
import { parseLiveToolEvent } from './tool-events.ts';

const offered = new Set(['inspect_workspace']);

function done(item: Record<string, unknown>) {
    return { type: 'response.event', delegation_id: 'd1', event: { type: 'response.output_item.done', item } };
}

describe('parseLiveToolEvent', () => {
    test('reads a finished call to an offered tool', () => {
        expect(parseLiveToolEvent(done({ type: 'function_call', call_id: 'c1', name: 'inspect_workspace', arguments: '{}' }), offered)).toEqual({
            delegationId: 'd1',
            type: 'response.output_item.done',
            call: { callId: 'c1', name: 'inspect_workspace', arguments: '{}' }
        });
    });

    test('a call to a tool that was never offered, or with arguments that are no string, runs nothing', () => {
        expect(parseLiveToolEvent(done({ type: 'function_call', call_id: 'c1', name: 'manage_git', arguments: '{}' }), offered)?.call).toBeNull();
        expect(parseLiveToolEvent(done({ type: 'function_call', call_id: 'c1', name: 'inspect_workspace', arguments: {} }), offered)?.call).toBeNull();
        expect(parseLiveToolEvent(done({ type: 'message' }), offered)?.call).toBeNull();
    });

    test('an event without a delegation, a nested event or a type is no response event', () => {
        expect(parseLiveToolEvent({ type: 'response.event', event: { type: 'response.completed' } }, offered)).toBeNull();
        expect(parseLiveToolEvent({ type: 'response.event', delegation_id: 'd1', event: null }, offered)).toBeNull();
        expect(parseLiveToolEvent({ type: 'response.event', delegation_id: 'd1', event: {} }, offered)).toBeNull();
        expect(parseLiveToolEvent({ type: 'session.started' }, offered)).toBeNull();
    });
});
