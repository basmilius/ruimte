import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFiles } from './files.ts';
import { attachmentFlags, stageArtifact, type ArtifactUploads } from './uploads.ts';

let root: string;
let files: AgentFiles;

/* Holds the bytes of each file of each upload, as the artifact store stages them. */
function memoryUploads(): ArtifactUploads & { held: Map<string, Uint8Array[]> } {
    const held = new Map<string, Uint8Array[]>();

    return {
        held,
        uploadState: async (_caller, upload) => ({ sizes: (held.get(upload) ?? []).map((bytes) => bytes.length), done: null }),
        uploadAppend: async (_caller, upload, index, offset, bytes) => {
            const files = held.get(upload) ?? [];
            const current = files[index] ?? new Uint8Array();

            if (offset !== current.length) {
                throw new Error(`piece at ${offset}, file holds ${current.length}`);
            }

            files[index] = Buffer.concat([current, bytes]);
            held.set(upload, files);

            return files[index]!.length;
        }
    };
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-mcp-uploads-')));
    files = new AgentFiles(root, [root]);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('stageArtifact', () => {
    test('stages every file under the request id and names them for the verb', async () => {
        await writeFile(join(root, 'report.md'), '# Report');
        await writeFile(join(root, 'empty.txt'), '');
        const uploads = memoryUploads();

        const flags = await stageArtifact(uploads, files, 'chat-1', ['report.md', 'empty.txt'], 'r1');

        expect(flags).toEqual([
            '--request-id=r1',
            '--upload=r1',
            `--files=${JSON.stringify([
                { name: 'report.md', size: 8 },
                { name: 'empty.txt', size: 0 }
            ])}`
        ]);
        expect(uploads.held.get('r1')?.map((bytes) => Buffer.from(bytes).toString())).toEqual(['# Report', '']);
    });

    test('goes on where an earlier call under the same request id stopped', async () => {
        await writeFile(join(root, 'report.md'), '# Report');
        const uploads = memoryUploads();
        uploads.held.set('r1', [Buffer.from('# Re')]);

        await stageArtifact(uploads, files, 'chat-1', ['report.md'], 'r1');

        expect(Buffer.from(uploads.held.get('r1')![0]!).toString()).toBe('# Report');
    });

    test('a file outside the allowed folders is refused before anything is sent', async () => {
        const uploads = memoryUploads();

        await expect(stageArtifact(uploads, files, 'chat-1', ['/etc/hosts'], 'r1')).rejects.toMatchObject({ code: 'path-outside' });
        expect(uploads.held.size).toBe(0);
    });
});

describe('attachmentFlags', () => {
    test('a file that is no image or model is refused', async () => {
        await writeFile(join(root, 'notes.txt'), 'plain text');

        await expect(attachmentFlags(files, 'notes.txt', undefined)).rejects.toMatchObject({ code: 'attach-not-image' });
    });

    test('an image goes as its name and its bytes', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(17).fill(0)]);
        await writeFile(join(root, 'shot.png'), png);

        expect(await attachmentFlags(files, 'shot.png', undefined)).toEqual(['--name=shot.png', `--data=${png.toString('base64')}`]);
    });
});
