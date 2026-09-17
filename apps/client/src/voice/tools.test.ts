import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VOICE_TOOL_DEFINITIONS, type ProjectCanvasView, type ProjectDocument } from '@ruimte/contracts';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { executeVoiceTool } from '@/voice/tools';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const document: ProjectDocument = {
    version: 2,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [main, { kind: 'canvas', id: 'release', name: 'Release', nodes: [], texts: [], edges: [], layouts: [] }]
};

beforeEach(() => {
    useDocument.getState().load(document, { activeViewId: 'main', views: {} });
    defaultCanvases.of('main').getState().loadView(main, null);
    defaultCanvases.focus('main');
});

afterEach(() => {
    useDocument.getState().load(null, null);
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('Voice domain tools', () => {
    test('exposes four compact tools with strict object inputs', () => {
        expect(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(['inspect_workspace', 'manage_views', 'manage_canvas', 'communicate']);
        expect(VOICE_TOOL_DEFINITIONS.every((tool) => tool.strict && tool.parameters.additionalProperties === false)).toBe(true);
    });

    test('focuses a view through manage_views and the shared registry', async () => {
        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'focus', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(result.output).toMatchObject({ ok: true, message: 'Focused the view “Release”.', viewId: 'release' });
        expect(result.action).toMatchObject({ kind: 'focus', label: 'Focused view', detail: 'Release' });
        expect(useDocument.getState().activeViewId).toBe('release');
    });

    test('creates a complete reminder note through manage_canvas', async () => {
        const result = await executeVoiceTool(
            'manage_canvas',
            JSON.stringify({
                action: 'create_node',
                node: null,
                kind: 'note',
                name: null,
                title: null,
                content: 'Fleur morgen mijn iPhone laten zien',
                url: null,
                command: null
            })
        );
        expect(result.output).toMatchObject({ ok: true, kind: 'note', node: 'Fleur morgen mijn iPhone laten zien' });
        expect(Object.values(defaultCanvases.of('main').getState().nodes)[0]).toMatchObject({ body: 'Fleur morgen mijn iPhone laten zien' });
    });
});
