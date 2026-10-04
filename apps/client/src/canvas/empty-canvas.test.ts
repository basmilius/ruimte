import { describe, expect, test } from 'bun:test';
import type { ProjectView, ProviderInfo } from '@ruimte/contracts';
import { emptyCanvasSections, type EmptyCanvasInput } from './empty-canvas';

function provider(kind: ProviderInfo['kind'], patch: { installed?: boolean; chat?: boolean; terminal?: boolean } = {}): ProviderInfo {
    return {
        kind,
        name: kind,
        installed: patch.installed ?? true,
        version: null,
        models: [],
        defaultModel: null,
        capabilities: { chat: patch.chat ?? true, terminal: patch.terminal ?? true },
        resumeCommand: ''
    } as unknown as ProviderInfo;
}

function input(patch: Partial<EmptyCanvasInput> = {}): EmptyCanvasInput {
    return {
        providers: [],
        hasFolder: false,
        layouts: [],
        views: [],
        ...patch
    };
}

function ids(tiles: { id: string }[]): string[] {
    return tiles.map((tile) => tile.id);
}

describe('the tiles of an empty canvas', () => {
    test('terminal agents stay available beside the chat with a model picker', () => {
        const { agents } = emptyCanvasSections(
            input({ providers: [provider('claude'), provider('codex', { terminal: false }), provider('gemini', { installed: false })] })
        );
        expect(ids(agents)).toEqual(['agent-terminal-claude', 'node-chat']);
    });

    test('the generic chat remains available without installed terminal agents', () => {
        expect(ids(emptyCanvasSections(input({ providers: [provider('claude', { installed: false })] })).agents)).toEqual(['node-chat']);
    });

    test('a file is offered only with a folder to pick it from', () => {
        expect(ids(emptyCanvasSections(input()).place)).toEqual(['node-terminal', 'node-browser', 'node-note', 'node-group', 'text']);
        expect(ids(emptyCanvasSections(input({ hasFolder: true })).place)).toContain('file');
    });

    test('the project section holds the layouts of the canvas and its drawings and diagrams, and nothing when it has none', () => {
        const views = [
            { kind: 'canvas', id: 'main', name: 'Main' },
            { kind: 'drawing', id: 'sketch', name: 'Sketch' },
            { kind: 'diagram', id: 'flow', name: 'Flow' }
        ] as unknown as ProjectView[];
        expect(ids(emptyCanvasSections(input({ layouts: [{ name: 'Review' }], views })).project)).toEqual(['layout-Review', 'view-sketch', 'view-flow']);
        expect(emptyCanvasSections(input()).project).toEqual([]);
    });
});
