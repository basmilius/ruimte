import { expect, test } from 'bun:test';
import { compileUiBlock, evaluateUiBlock, UI_GROUPS } from '@adecore/intelligent-ui';
import type { CanvasHost } from '../canvas/host.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

async function catalog(group: string): Promise<string[]> {
    return (await toolAnswer('ui_catalog', { group }, toolCall('chat-1', {} as CanvasHost))).lines;
}

test('a group prints what it is for, its rules and a row per component with its props', async () => {
    const lines = await catalog('data');
    expect(lines[0]).toBe('about\tCompare values and records. Components: Stats, Stat, EntityList, Entry, Table, Column, Chart');
    expect(lines).toContain('component\tStat\tlabel, value, previous?, unit?, tone?\tA labeled value and optional previous value.');
    expect(lines.find((line) => line.startsWith('rules\t'))).toContain('Give numbers as numbers');
    expect(lines.filter((line) => line.startsWith('component\t')).map((line) => line.split('\t')[1])).toEqual([
        'Stats',
        'Stat',
        'EntityList',
        'Entry',
        'Table',
        'Column',
        'Chart'
    ]);
});

test('the data reference shows formatted durations in entries that compile and evaluate', async () => {
    const lines = await catalog('data');
    expect(lines.find((line) => line.startsWith('rules\t'))).toContain('Stat value and previous take numbers');
    const example = lines.find((line) => line.startsWith('example\t'))?.slice('example\t'.length);
    expect(example).toBeDefined();

    const block = compileUiBlock(example!, { id: 'duration-example', final: true, now: () => 0 });
    expect(block.diagnostics).toEqual([]);

    const result = evaluateUiBlock(block, undefined, { milliseconds: Number.MAX_SAFE_INTEGER });
    expect(result.diagnostics).toEqual([]);
    expect(result.nodes[0]?.type).toBe('EntityList');
    expect(result.nodes[0]?.children.map((node) => node.type)).toEqual(['Entry', 'Entry']);
    expect(block.fallback).toContain('ci: 21 min 38 sec');
    expect(block.fallback).toContain('far-future-clock: 16 min 46 sec');
});

test('every group prints a rule and at least one component with a description', async () => {
    for (const group of Object.keys(UI_GROUPS)) {
        const lines = await catalog(group);
        expect(lines.find((line) => line.startsWith('rules\t'))).toBeDefined();
        const components = lines.filter((line) => line.startsWith('component\t'));
        expect(components.length).toBeGreaterThan(0);

        for (const line of components) {
            const [, name, props, description] = line.split('\t');
            expect(name).toMatch(/^[A-Z]\w+$/);
            expect(props).not.toBe('');
            expect(description).not.toBe('');
        }
    }
});

test('the places group tells agents to give lat and lon since Ruimte looks up no addresses', async () => {
    const rules = (await catalog('places')).find((line) => line.startsWith('rules\t'));
    expect(rules).toContain('Ruimte does not look up addresses, so give lat and lon for every Place');
    expect(rules).toContain('an address may still be given as text');
});

test('the content group says how to attach a file of your own', async () => {
    const rules = (await catalog('content')).find((line) => line.startsWith('rules\t'));
    expect(rules).toContain('attach it with chat_attach and its path');
    expect(rules).toContain('or on Model for a binary glTF, USDZ or STL');
    expect(rules).toContain('Image, Gallery and Compare');
    expect((await catalog('data')).find((line) => line.startsWith('rules\t'))).not.toContain('chat_attach');
});

test('ui_catalog refuses a group that does not exist and names the ones that do', async () => {
    const [line] = await catalog('nope');
    expect(line).toBe(`refused\tbad-arguments\tui_catalog needs group, one of ${Object.keys(UI_GROUPS).join(', ')}`);
});
