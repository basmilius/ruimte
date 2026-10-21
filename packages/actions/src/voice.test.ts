import { describe, expect, test } from 'bun:test';
import { NODE_ACCENT_NAMES } from '@ruimte/contracts';
import { ACTION_DEFINITIONS, ACTION_DOMAINS, VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS, voiceToolDefinitions, voiceToolsFor, type ActionName } from './index.ts';

const reached = [...VOICE_TOOL_ACTIONS.values()].flat();

describe('Voice tools', () => {
    test('reach every action Voice may run, each through one tool', () => {
        const voiceActions = (Object.keys(ACTION_DEFINITIONS) as ActionName[]).filter((name) => ACTION_DEFINITIONS[name].actors.includes('voice'));
        expect([...reached].sort()).toEqual([...voiceActions].sort());
        expect(new Set(reached).size).toBe(reached.length);
    });

    test('name only actions that exist and allow Voice', () => {
        for (const tool of voiceToolDefinitions().filter((definition) => definition.name !== VOICE_CONTROL_TOOL)) {
            const actions = tool.parameters.properties.action?.enum as string[];
            expect(actions).toEqual([...(VOICE_TOOL_ACTIONS.get(tool.name) ?? [])]);
            for (const action of actions) {
                expect(Object.hasOwn(ACTION_DEFINITIONS, action)).toBe(true);
                expect(ACTION_DEFINITIONS[action as ActionName].actors.includes('voice')).toBe(true);
            }
        }
    });

    test('are named by the tool actions and the control tool, which name them without building a schema', () => {
        expect(voiceToolDefinitions().map((tool) => tool.name)).toEqual([...VOICE_TOOL_ACTIONS.keys(), VOICE_CONTROL_TOOL]);
    });

    test('are strict: every field required, no extra fields, no keyword outside the strict subset', () => {
        expect(new Set(voiceToolDefinitions().map((tool) => tool.name)).size).toBe(voiceToolDefinitions().length);
        expect(voiceToolDefinitions().map((tool) => tool.name)).toContain(VOICE_CONTROL_TOOL);
        for (const tool of voiceToolDefinitions()) {
            expect(tool.strict).toBe(true);
            expect(tool.parameters.additionalProperties).toBe(false);
            expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties));
            expect(JSON.stringify(tool)).not.toMatch(/"(\$schema|minLength|maxLength)"/);
        }
    });

    test('a field one action of a tool leaves out may be null', () => {
        const views = voiceToolDefinitions().find((tool) => tool.name === 'manage_views');
        expect(views?.parameters.properties.viewId).toEqual({ type: ['string', 'null'] });
        const canvas = voiceToolDefinitions().find((tool) => tool.name === 'manage_canvas');
        expect(canvas?.parameters.properties.viewId).toEqual({ type: 'string' });
    });

    test('color a node from the canvas tool, with the accents or none, and no longer from content', () => {
        const canvas = voiceToolDefinitions().find((tool) => tool.name === 'manage_canvas')!;
        expect(canvas.parameters.properties.color?.enum).toEqual([...NODE_ACCENT_NAMES, null]);
        expect(canvas.parameters.properties.action?.enum).toContain('node.setColor');
        const content = voiceToolDefinitions().find((tool) => tool.name === 'edit_content')!;
        expect(JSON.stringify(content)).not.toContain('setColor');
    });

    test('leave out what only an agent may give', () => {
        const canvas = voiceToolDefinitions().find((tool) => tool.name === 'manage_canvas')!;
        for (const field of ['source', 'cwd', 'beside', 'label', 'resume']) {
            expect(canvas.parameters.properties).not.toHaveProperty(field);
        }
        expect(canvas.parameters.properties.kind?.enum).not.toContain('drawing');
        const views = voiceToolDefinitions().find((tool) => tool.name === 'manage_views')!;
        for (const field of ['after', 'device', 'resume', 'cwd']) {
            expect(views.parameters.properties).not.toHaveProperty(field);
        }
        expect(views.parameters.properties.kind?.enum).not.toContain('device');
        expect(views.parameters.properties.action?.enum).not.toContain('view.move');
        expect(JSON.stringify(voiceToolDefinitions())).not.toContain('"actors"');
    });

    test('git leaves out what only a person decides: history, resolutions, removal and how a diverged branch comes together', () => {
        const git = voiceToolDefinitions().find((tool) => tool.name === 'manage_git')!;
        for (const field of ['run', 'stageAll', 'stashFirst', 'force', 'remove', 'stopAgent', 'into', 'commitFirst', 'onto', 'content', 'take', 'hash']) {
            expect(git.parameters.properties).not.toHaveProperty(field);
        }
        const actions = git.parameters.properties.action?.enum as string[];
        for (const action of ['git.rebase', 'git.resolveConflict', 'git.proposeResolution', 'worktree.remove']) {
            expect(actions).not.toContain(action);
        }
        expect(git.parameters.properties.step?.enum).toEqual(['abort', null]);
        expect(git.parameters.properties.strategy?.enum).toEqual(['merge', 'squash', null]);
    });

    test('chats, terminals and plans leave out what only a person decides: approvals, the permission mode, unlocking and what the composer attaches', () => {
        const tool = (name: string) => voiceToolDefinitions().find((definition) => definition.name === name)!;
        const reachable = voiceToolDefinitions().flatMap((definition) => (definition.parameters.properties.action?.enum as string[] | undefined) ?? []);
        for (const action of ['chat.approve', 'plan.unlock', 'plan.setStatus']) {
            expect(reachable).not.toContain(action);
        }
        for (const field of ['runtimeMode', 'selection', 'asView', 'filesAfterTurn']) {
            expect(tool('run_sessions').parameters.properties).not.toHaveProperty(field);
        }
        for (const field of ['force', 'mentions', 'skills', 'attachments']) {
            expect(tool('communicate').parameters.properties).not.toHaveProperty(field);
        }
        expect(tool('manage_plans').parameters.properties).not.toHaveProperty('next');
        expect(tool('run_sessions').parameters.properties.answers).toMatchObject({
            type: ['array', 'null'],
            items: { type: 'object', required: ['questionId', 'answer'], additionalProperties: false }
        });
    });

    test('files, content and pages leave out what only a person does: saving a file, pasting whole elements and search limits', () => {
        const tool = (name: string) => voiceToolDefinitions().find((definition) => definition.name === name)!;
        const reachable = voiceToolDefinitions().flatMap((definition) => (definition.parameters.properties.action?.enum as string[] | undefined) ?? []);
        for (const action of ['drawing.export', 'diagram.export', 'browser.screenshot']) {
            expect(reachable).not.toContain(action);
        }
        expect(tool('browse_files').parameters.properties).not.toHaveProperty('limit');
        expect(tool('edit_content').parameters.properties).not.toHaveProperty('copies');
        expect(tool('edit_content').parameters.properties.format?.enum).toEqual(['png', 'svg', 'elements', 'json', null]);
        expect(Object.keys(tool('browse_pages').parameters.properties).sort()).toEqual(['action', 'hard', 'nodeId', 'url']);
        // A nested object is as strict as the tool around it: every field there, each one nullable.
        expect(tool('edit_content').parameters.properties.style).toMatchObject({
            anyOf: [{ type: 'object', additionalProperties: false, required: expect.arrayContaining(['stroke', 'textSize']) }, { type: 'null' }]
        });
        expect(tool('edit_content').parameters.properties.elements).toMatchObject({
            type: ['array', 'null'],
            items: { type: 'object', additionalProperties: false, required: ['kind', 'x', 'y', 'w', 'h', 'text', 'color'] }
        });
    });

    test('a subset carries the tools of its domains in catalog order, and always the control tool', () => {
        expect(voiceToolsFor([]).map((tool) => tool.name)).toEqual([VOICE_CONTROL_TOOL]);
        expect(voiceToolsFor(['machine', 'workspace']).map((tool) => tool.name)).toEqual(['inspect_workspace', 'inspect_machine', VOICE_CONTROL_TOOL]);
        expect(voiceToolsFor(ACTION_DOMAINS)).toEqual([...voiceToolDefinitions()]);
    });

    test('a person-only field stays out, and so does an action only a person or an agent runs', () => {
        const projects = voiceToolDefinitions().find((tool) => tool.name === 'manage_projects')!;
        expect(Object.keys(projects.parameters.properties)).not.toContain('image');
        expect(projects.parameters.properties.action?.enum).not.toContain('project.delete');
        expect(voiceToolDefinitions().find((tool) => tool.name === 'inspect_machine')!.parameters.properties.action?.enum).not.toContain('process.signal');
    });
});
