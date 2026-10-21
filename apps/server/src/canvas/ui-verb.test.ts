import { expect, test } from 'bun:test';
import { compileUiBlock, evaluateUiBlock, UI_GROUPS } from '@adecore/intelligent-ui';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import type { CanvasHost, Verb } from './verb.ts';
import { verbNamed } from './verbs.ts';

const call = { caller: 'chat-1', host: {} as CanvasHost };

async function run(name: string, ...argv: string[]): Promise<string[]> {
    return (verbNamed(name) as Verb).run(argv, call);
}

test('help ui prints the syntax and the sources, and one action row per catalog group', async () => {
    const lines = await run('help', 'ui');
    expect(lines.find((line) => line.startsWith('syntax\t'))).toContain(RUIMTE_UI_FENCE);
    expect(lines.filter((line) => line.startsWith('example\t'))[0]).toBe(`example\t\`\`\`${RUIMTE_UI_FENCE}`);
    expect(lines.find((line) => line.startsWith('query\t'))).toContain('git.status {repo: "."}');
    expect(lines.filter((line) => line.startsWith('action\t')).map((line) => line.split('\t')[1])).toEqual(
        Object.keys(UI_GROUPS).map((group) => `ui ${group}`)
    );
    expect(lines).toContain('action\tui data\t\tCompare values and records. Components: Stats, Stat, EntityList, Entry, Table, Column, Chart');
    // The components wait in the group, so the root stays short.
    expect(lines.some((line) => line.startsWith('component\t'))).toBe(false);
    expect(lines.length).toBeLessThan(30);
});

test('help ui <group> prints the rules and a row per component with its props', async () => {
    const lines = await run('help', 'ui', 'data');
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

test('ui <group> prints what help ui <group> details', async () => {
    const detail = await run('help', 'ui', 'places');
    const printed = await run('ui', 'places');
    expect(printed.filter((line) => line.startsWith('component\t')).length).toBe(2);
    for (const line of printed) {
        expect(detail).toContain(line);
    }
});

test('the data reference shows formatted durations in entries that compile and evaluate', async () => {
    const lines = await run('help', 'ui', 'data');
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
        const lines = await run('ui', group);
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
    const rules = (await run('ui', 'places')).find((line) => line.startsWith('rules\t'));
    expect(rules).toContain('Ruimte does not look up addresses, so give lat and lon for every Place');
    expect(rules).toContain('an address may still be given as text');
});

test('the content group says how to attach a file of your own', async () => {
    const rules = (await run('ui', 'content')).find((line) => line.startsWith('rules\t'));
    expect(rules).toContain('ruimte-context chat attach --file <path>');
    expect(rules).toContain('or on Model for a binary glTF, USDZ or STL');
    expect(rules).toContain('Image, Gallery and Compare');
    expect((await run('ui', 'data')).find((line) => line.startsWith('rules\t'))).not.toContain('chat attach');
});

test('ui refuses a group that does not exist and names the ones that do', async () => {
    await expect(run('ui', 'nope')).rejects.toMatchObject({ code: 'unknown-action' });
    await expect(run('help', 'ui', 'nope')).rejects.toMatchObject({ code: 'unknown-action' });
});
