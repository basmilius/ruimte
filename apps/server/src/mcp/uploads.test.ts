import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFiles } from './files.ts';
import { stageArtifact, type ArtifactUploads } from './uploads.ts';

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
    test('stages every file under the request id and names them for the publish', async () => {
        await writeFile(join(root, 'report.md'), '# Report');
        await writeFile(join(root, 'empty.txt'), '');
        const uploads = memoryUploads();

        const staged = await stageArtifact(uploads, files, 'chat-1', ['report.md', 'empty.txt'], 'r1');

        expect(staged).toEqual({
            requestId: 'r1',
            upload: 'r1',
            files: [
                { name: 'report.md', size: 8 },
                { name: 'empty.txt', size: 0 }
            ]
        });
        expect(uploads.held.get('r1')?.map((bytes) => Buffer.from(bytes).toString())).toEqual(['# Report', '']);
    });

    test('goes on where an earlier call under the same request id stopped', async () => {
        await writeFile(join(root, 'report.md'), '# Report');
        const uploads = memoryUploads();
        uploads.held.set('r1', [Buffer.from('# Re')]);

        await stageArtifact(uploads, files, 'chat-1', ['report.md'], 'r1');

        expect(Buffer.from(uploads.held.get('r1')![0]!).toString()).toBe('# Report');
    });

    test('a link swapped in after the file was judged is never followed', async () => {
        const outside = await mkdtemp(join(tmpdir(), 'ruimte-mcp-outside-'));
        const report = join(root, 'report.md');
        await writeFile(join(outside, 'secret.txt'), 'outside the project');
        await writeFile(report, '# Report');
        const uploads = memoryUploads();
        const state = uploads.uploadState;
        uploads.uploadState = async (...args) => {
            await rm(report);
            await symlink(join(outside, 'secret.txt'), report);

            return state(...args);
        };

        try {
            await stageArtifact(uploads, files, 'chat-1', ['report.md'], 'r1');

            expect(Buffer.from(uploads.held.get('r1')![0]!).toString()).toBe('# Report');
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    test('a file that shrinks while it is sent is refused as changed', async () => {
        const report = join(root, 'report.md');
        await writeFile(report, '0123456789');
        const uploads = memoryUploads();
        const state = uploads.uploadState;
        const append = uploads.uploadAppend;
        let appends = 0;
        uploads.uploadState = async (...args) => {
            await truncate(report, 3);

            return state(...args);
        };
        uploads.uploadAppend = async (...args) => {
            appends += 1;

            if (appends > 10) {
                throw new Error('the upload made no progress');
            }

            return append(...args);
        };

        await expect(stageArtifact(uploads, files, 'chat-1', ['report.md'], 'r1')).rejects.toMatchObject({ code: 'file-changed' });
    });

    test('a file outside the allowed folders is refused before anything is sent', async () => {
        const uploads = memoryUploads();

        await expect(stageArtifact(uploads, files, 'chat-1', ['/etc/hosts'], 'r1')).rejects.toMatchObject({ code: 'path-outside' });
        expect(uploads.held.size).toBe(0);
    });
});
