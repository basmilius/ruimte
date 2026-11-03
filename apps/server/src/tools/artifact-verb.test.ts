import { beforeEach, describe, expect, test } from 'bun:test';
import { ArtifactStore } from '../artifacts/artifact-store.ts';
import { Artifacts } from '../artifacts/artifacts.ts';
import { MemoryArtifactFs } from '../artifacts/memory-artifact-fs.ts';
import { type CanvasHost, type Noun } from './verb.ts';
import { printed } from './verb-test-helpers.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('artifact') as Noun;

let artifacts: Artifacts;
let host: CanvasHost;

beforeEach(async () => {
    let next = 0;
    const store = new ArtifactStore({ root: '/home/artifacts', fs: new MemoryArtifactFs(), now: () => 0, newId: () => `id${String(++next).padStart(8, '0')}` });
    await store.load();
    const projectOf = (id: string): string | null => (id === 'chat-other' ? 'p2' : id.startsWith('chat-') ? 'p1' : null);
    artifacts = new Artifacts({
        store,
        home: '/home',
        machineId: 'machine-1',
        projects: {
            known: async () => [
                { projectId: 'p1', name: 'One', folder: '/work/one' },
                { projectId: 'p2', name: 'Two', folder: '/work/two' }
            ],
            projectOf
        },
        chats: { findAttachment: async () => null, hasStored: async () => true },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async (caller) => ({ maker: 'agent', machineId: 'machine-1', chatId: caller, nodeId: caller })
    });
    host = {
        projects: { locate: (id: string) => (projectOf(id) === null ? null : { projectId: projectOf(id)!, folder: '/work', canvasId: 'main' }) },
        artifacts
    } as unknown as CanvasHost;
});

function run(argv: string[], caller = 'chat-1'): Promise<string[]> {
    return printed(noun, argv, { caller, host });
}

async function upload(caller: string, id: string, text: string): Promise<void> {
    await artifacts.uploadAppend(caller, id, 0, 0, new TextEncoder().encode(text));
}

describe('artifact', () => {
    test('publish keeps what was uploaded, and list and read show it in the same project only', async () => {
        await upload('chat-1', 'up-1', '# Weekly\nAll green');
        const published = await run([
            'publish',
            '--upload=up-1',
            '--request-id=up-1',
            `--files=${JSON.stringify([{ name: 'weekly.md', size: 18 }])}`,
            '--key',
            'weekly'
        ]);
        expect(published[0]).toMatch(/^artifact\tart-\w+\tver-\w+\t1\treport\tweekly\t1\t18$/);
        const artifactId = published[0]!.split('\t')[1]!;

        const listed = await run(['list']);
        expect(listed).toEqual([expect.stringMatching(new RegExp(`^artifact\t${artifactId}\tver-\\w+\t1\treport\tweekly\tweekly\t1970-01-01T00:00:00.000Z$`))]);
        const read = await run(['read', artifactId]);
        expect(read.slice(1)).toEqual(['file\t0\tweekly.md\ttext/markdown\t18', '', '# Weekly\nAll green']);

        expect(await run(['list'], 'chat-other')).toEqual(["note\tThis project's Output is empty"]);
        expect((await run(['read', artifactId], 'chat-other'))[0]).toBe('refused\tnot-found\tNo such artifact in this project');
    });

    test('a retry with the same request id says it saved nothing new', async () => {
        await upload('chat-1', 'up-1', 'one');
        const words = ['publish', '--upload=up-1', '--request-id=up-1', `--files=${JSON.stringify([{ name: 'a.txt', size: 3 }])}`];
        const first = await run(words);
        const again = await run(words);
        expect(again[0]).toBe(first[0]);
        expect(again[1]).toStartWith('note\tAn earlier call with this request id saved this version');
    });

    test('a publish without the files ruimte-context sends is refused, and so is a reserved or malformed key', async () => {
        expect((await run(['publish', '--file', 'a.md']))[0]).toStartWith('refused\tbad-arguments\t');
        await upload('chat-1', 'up-1', 'one');
        const files = `--files=${JSON.stringify([{ name: 'a.txt', size: 3 }])}`;
        expect((await run(['publish', '--upload=up-1', '--request-id=r', files, '--key', 'Weekly']))[0]).toStartWith('refused\t');
        expect((await run(['publish', '--upload=up-1', '--request-id=r', files, '--kind', 'video']))[0]).toStartWith('refused\t');
    });
});
