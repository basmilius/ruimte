import { describe, expect, test } from 'bun:test';
import { catalog } from './catalog-test-helpers.ts';
import type { ToolContext } from './catalog.ts';

const DESIGN_NAMES = [
    'context_list',
    'context_read',
    'task_done',
    'notify',
    'alert',
    'agent_answer',
    'agent_start',
    'agent_team',
    'agent_fork',
    'flag',
    'ui_catalog',
    'launch_list',
    'node_update',
    'view_edit',
    'browser_history',
    'launch_control',
    'routine_toggle',
    'language_lookup',
    'language_file',
    'provider_info',
    'device_input',
    'device_app',
    'plan_edit',
    'computer_act',
    'computer_menu',
    'guide'
];

describe('catalog', () => {
    test('the tools carry the names the design gives them', () => {
        const names = catalog().map((tool) => tool.name);

        expect(DESIGN_NAMES.filter((name) => !names.includes(name))).toEqual([]);
        expect(names).not.toContain('help');
        expect(names.every((name) => /^[a-z]+(_[a-z]+)*$/.test(name))).toBe(true);
    });

    test('a schema is one flat object without bounds, unions or nulls', () => {
        const text = JSON.stringify(catalog().map((tool) => tool.inputSchema));
        const keywords = ['additionalProperties', 'anyOf', 'oneOf', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', '"type":"null"'];

        expect(keywords.filter((keyword) => text.includes(keyword))).toEqual([]);
    });

    test('a bundle takes its action as a required choice', () => {
        const history = catalog().find((tool) => tool.name === 'browser_history')!;

        expect(history.inputSchema.required).toContain('action');
        expect(history.inputSchema.properties.action?.enum).toEqual(['back', 'forward', 'reload', 'stop']);
    });

    test('only the tools that remove or merge are marked destructive', () => {
        const destructive = catalog()
            .filter((tool) => tool.annotations.destructiveHint === true)
            .map((tool) => tool.name);

        expect(destructive.sort()).toEqual(
            [
                'database_execute',
                'link_delete',
                'node_delete',
                'operation_cancel',
                'plan_delete',
                'plan_remove',
                'view_delete',
                'visual_remove',
                'worktree_merge'
            ].sort()
        );
    });

    test('no description points at the CLI', () => {
        const pointing = catalog().filter((tool) => JSON.stringify([tool.description, tool.inputSchema]).includes('ruimte-context'));

        expect(pointing.map((tool) => tool.name)).toEqual([]);
    });

    test('every guide topic prints its format with fields in place of flags', async () => {
        const guide = catalog().find((tool) => tool.name === 'guide')!;
        const topics = guide.inputSchema.properties.topic?.enum ?? [];
        const printed = await Promise.all(topics.map((topic) => guide.run({ topic }, {} as ToolContext)));

        expect(guide.annotations).toEqual({ readOnlyHint: true });
        expect(guide.audience).toBe('everyone');
        expect(topics.filter((_topic, index) => printed[index]!.lines.length === 0)).toEqual([]);
        expect(printed.flatMap((outcome) => outcome.lines).filter((line) => /(^|\s)--[a-z]|ruimte-context/.test(line))).toEqual([]);
    });
});
