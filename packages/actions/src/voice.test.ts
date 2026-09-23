import { describe, expect, test } from 'bun:test';
import { ACTION_DEFINITIONS, VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS, VOICE_TOOL_DEFINITIONS, type ActionName } from './index.ts';

const reached = [...VOICE_TOOL_ACTIONS.values()].flat();

describe('Voice tools', () => {
    test('reach every action Voice may run, each through one tool', () => {
        const voiceActions = (Object.keys(ACTION_DEFINITIONS) as ActionName[]).filter((name) => ACTION_DEFINITIONS[name].actors.includes('voice'));
        expect([...reached].sort()).toEqual([...voiceActions].sort());
        expect(new Set(reached).size).toBe(reached.length);
    });

    test('name only actions that exist and allow Voice', () => {
        for (const tool of VOICE_TOOL_DEFINITIONS.filter((definition) => definition.name !== VOICE_CONTROL_TOOL)) {
            const actions = tool.parameters.properties.action?.enum as string[];
            expect(actions).toEqual([...(VOICE_TOOL_ACTIONS.get(tool.name) ?? [])]);
            for (const action of actions) {
                expect(Object.hasOwn(ACTION_DEFINITIONS, action)).toBe(true);
                expect(ACTION_DEFINITIONS[action as ActionName].actors.includes('voice')).toBe(true);
            }
        }
    });

    test('are strict: every field required, no extra fields, no keyword outside the strict subset', () => {
        expect(new Set(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(VOICE_TOOL_DEFINITIONS.length);
        expect(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).toContain(VOICE_CONTROL_TOOL);
        for (const tool of VOICE_TOOL_DEFINITIONS) {
            expect(tool.strict).toBe(true);
            expect(tool.parameters.additionalProperties).toBe(false);
            expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties));
            expect(JSON.stringify(tool)).not.toMatch(/"(\$schema|minLength|maxLength)"/);
        }
    });

    test('a field one action of a tool leaves out may be null', () => {
        const views = VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === 'manage_views');
        expect(views?.parameters.properties.viewId).toEqual({ type: ['string', 'null'] });
        const canvas = VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === 'manage_canvas');
        expect(canvas?.parameters.properties.viewId).toEqual({ type: 'string' });
    });

    test('leave out what only an agent may give', () => {
        const canvas = VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === 'manage_canvas')!;
        for (const field of ['source', 'cwd', 'beside', 'label', 'color', 'resume']) {
            expect(canvas.parameters.properties).not.toHaveProperty(field);
        }
        expect(canvas.parameters.properties.kind?.enum).not.toContain('drawing');
        const views = VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === 'manage_views')!;
        for (const field of ['after', 'device', 'resume', 'cwd']) {
            expect(views.parameters.properties).not.toHaveProperty(field);
        }
        expect(views.parameters.properties.kind?.enum).not.toContain('device');
        expect(views.parameters.properties.action?.enum).not.toContain('view.move');
        expect(JSON.stringify(VOICE_TOOL_DEFINITIONS)).not.toContain('"actors"');
    });
});
