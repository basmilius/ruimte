import { describe, expect, test } from 'bun:test';
import { VERBS } from '../canvas/verbs.ts';
import { catalog, withToolNames, catalogNames, type ToolContext } from './catalog.ts';

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
    test('every action of the registry has a tool, so a new verb cannot be left out', () => {
        const covered = new Set(catalog().flatMap((tool) => tool.covers));
        const registry = VERBS.flatMap((entry) => (entry.served === 'noun' ? entry.actions.map((action) => action.name) : [entry.name])).filter(
            (name) => name !== 'help'
        );

        expect(registry.filter((name) => !covered.has(name))).toEqual([]);
    });

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

    test('a CLI command in a sentence is written as its tool', () => {
        expect(withToolNames('ruimte-context node list lists them, and ruimte-context read reads one', catalogNames())).toBe(
            'node_list lists them, and context_read reads one'
        );
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

    test('an action id is written as its tool, and an operation id stays as the daemon wrote it', () => {
        expect(withToolNames('the id device.list gives it', catalogNames())).toBe('the id device_list gives it');
        expect(withToolNames('operation_get agent.start:abc says how it goes', catalogNames())).toBe('operation_get agent.start:abc says how it goes');
    });
});
