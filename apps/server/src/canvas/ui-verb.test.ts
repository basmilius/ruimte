import { expect, test } from 'bun:test';
import { UI_GROUPS } from '@adecore/intelligent-ui';
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
    // The components wait in the group, so the root stays short.
    expect(lines.some((line) => line.startsWith('component\t'))).toBe(false);
    expect(lines.length).toBeLessThan(30);
});

test('ui <group> prints what help ui <group> details', async () => {
    const detail = await run('help', 'ui', 'places');
    const printed = await run('ui', 'places');

    for (const line of printed) {
        expect(detail).toContain(line);
    }
});

test('the data group tells agents to put a formatted duration in an entry', async () => {
    const lines = await run('help', 'ui', 'data');
    expect(lines.find((line) => line.startsWith('rules\t'))).toContain('Stat value and previous take numbers');
    expect(lines.find((line) => line.startsWith('example\t'))).toBe(
        'example\t<EntityList><Entry label="ci">21 min 38 sec</Entry><Entry label="far-future-clock">16 min 46 sec</Entry></EntityList>'
    );
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
