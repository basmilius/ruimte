import { expect, test } from 'bun:test';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import type { CanvasHost, Verb } from './verb.ts';
import { verbNamed } from './verbs.ts';

test('help ui prints the reference as key and value lines, with the query sources of this machine', async () => {
    const help = verbNamed('help') as Verb;
    const lines = await help.run(['ui'], { caller: 'chat-1', host: {} as CanvasHost });
    const detail = lines.filter((line) => /^[a-z]+\t/.test(line));
    expect(detail.map((line) => line.split('\t')[0])).toEqual(expect.arrayContaining(['when', 'syntax', 'example', 'status', 'data', 'query']));
    expect(detail.find((line) => line.startsWith('syntax\t'))).toContain(RUIMTE_UI_FENCE);
    expect(detail.filter((line) => line.startsWith('example\t'))[0]).toBe(`example\t\`\`\`${RUIMTE_UI_FENCE}`);
    expect(detail.find((line) => line.startsWith('data\t'))).toContain('Stat: A labeled value');
    expect(detail.find((line) => line.startsWith('query\t'))).toContain('git.status {repo: "."}');
    // Every line of the reference is a line of the detail; none is a bare sentence.
    expect(lines.filter((line) => line.startsWith('Summary:') || line === '')).toEqual([]);
});
