import { describe, expect, test } from 'bun:test';
import type { ProjectView, ProviderInfo } from '@ruimte/contracts';
import { emptyCanvasSections, emptyCanvasSize, type EmptyCanvasInput } from './empty-canvas';

const provider = (kind: ProviderInfo['kind'], patch: { installed?: boolean; chat?: boolean; terminal?: boolean } = {}): ProviderInfo =>
    ({
        kind,
        name: kind,
        installed: patch.installed ?? true,
        version: null,
        models: [],
        defaultModel: null,
        capabilities: { chat: patch.chat ?? true, terminal: patch.terminal ?? true },
        resumeCommand: ''
    }) as unknown as ProviderInfo;

const input = (patch: Partial<EmptyCanvasInput> = {}): EmptyCanvasInput => ({
    providers: [],
    loaded: true,
    hasFolder: false,
    layouts: [],
    views: [],
    ...patch
});

const ids = (tiles: { id: string }[]): string[] => tiles.map((tile) => tile.id);

describe('the tiles of an empty canvas', () => {
    test('an agent that is installed gets a tile per kind of node it runs in, and the chat with a model picker stays beside them', () => {
        const { agents } = emptyCanvasSections(
            input({ providers: [provider('claude'), provider('codex', { terminal: false }), provider('gemini', { installed: false })] })
        );
        expect(ids(agents)).toEqual(['agent-chat-claude', 'agent-chat-codex', 'agent-terminal-claude', 'node-chat']);
    });

    test('a machine without any agent offers one tile that goes to where agents are set up', () => {
        expect(ids(emptyCanvasSections(input({ providers: [provider('claude', { installed: false })] })).agents)).toEqual(['agents-setup', 'node-chat']);
    });

    test('before the machine answered it says it is still asking rather than that nothing is there', () => {
        expect(ids(emptyCanvasSections(input({ loaded: false })).agents)).toEqual(['agents-connecting', 'node-chat']);
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

describe('the size the grid takes', () => {
    test('follows the cell, not the window', () => {
        expect(emptyCanvasSize({ w: 1200, h: 800 })).toBe('full');
        expect(emptyCanvasSize({ w: 500, h: 800 })).toBe('compact');
        expect(emptyCanvasSize({ w: 1200, h: 300 })).toBe('compact');
        expect(emptyCanvasSize({ w: 200, h: 800 })).toBe('minimal');
    });
});
