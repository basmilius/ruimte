import { describe, expect, test } from 'bun:test';
import type { Artifact, ArtifactVersion } from '@ruimte/contracts';
import type { ExtensionPublishInput } from '../artifacts/artifacts.ts';
import { outputOf, runMachineAction, type ExecuteAction, type PublishFiles } from './machine-actions.ts';

const noPublish: PublishFiles = async () => {
    throw new Error('No Output here');
};

describe('runMachineAction', () => {
    test('hands the action ids for refs and answers the shape of the extension API', async () => {
        const asked: unknown[] = [];
        const execute = (async (action: string, input: unknown) => {
            asked.push({ action, input });

            return { nodeId: 'browser-1', open: true, page: null, error: null, path: '/tmp/shot.png' };
        }) as ExecuteAction;

        expect(await runMachineAction('browser.screenshot', { node: { id: 'browser-1' } }, execute, noPublish)).toEqual({
            node: { id: 'browser-1' },
            open: true,
            page: null,
            error: null,
            path: '/tmp/shot.png'
        });
        expect(asked).toEqual([{ action: 'browser.screenshot', input: { nodeId: 'browser-1' } }]);
    });

    test('refuses a name outside the list, and an input of the wrong shape as an argument error', async () => {
        const execute = (async () => ({})) as ExecuteAction;

        await expect(runMachineAction('session.write', {}, execute, noPublish)).rejects.toMatchObject({ code: 'not-found' });
        await expect(runMachineAction('launch.start', { name: 'web' }, execute, noPublish)).rejects.toMatchObject({ code: 'invalid-input' });
    });
});

describe('an extension publishing to Output', () => {
    const execute = (async () => {
        throw new Error('Not an action of the machine');
    }) as ExecuteAction;

    test('sends its files with the call, as text or base64, and reads back the artifact and its version', async () => {
        const published: ExtensionPublishInput[] = [];
        const publish: PublishFiles = async (input) => {
            published.push(input);

            return {
                artifact: { artifactId: 'artifact-1', title: 'Weekly', kind: 'report', key: 'weekly', createdAt: 1 } as Artifact,
                version: { versionId: 'version-1', number: 1 } as ArtifactVersion,
                result: { existing: false }
            };
        };
        const input = {
            files: [
                { name: 'weekly.md', text: '# Weekly' },
                { name: 'data.bin', base64: Buffer.from([1, 2, 3]).toString('base64') }
            ],
            title: 'Weekly',
            key: 'weekly'
        };

        expect(await runMachineAction('artifact.publish', input, execute, publish)).toEqual({
            artifact: { id: 'artifact-1', title: 'Weekly', kind: 'report', key: 'weekly', createdAt: 1 },
            version: { id: 'version-1', number: 1 },
            existing: false
        });
        expect(published.map(({ files, title, key }) => ({ files: files.map((file) => [file.name, [...file.bytes]]), title, key }))).toEqual([
            {
                files: [
                    ['weekly.md', [...new TextEncoder().encode('# Weekly')]],
                    ['data.bin', [1, 2, 3]]
                ],
                title: 'Weekly',
                key: 'weekly'
            }
        ]);
        expect(published[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    });

    test('refuses an upload it cannot send, and more than one frame carries', async () => {
        const upload = { upload: 'u', files: [{ name: 'a.txt', size: 1 }], requestId: 'r' };
        const large = { files: [{ name: 'a.txt', text: 'x'.repeat(2 * 1024 * 1024 + 1) }] };

        await expect(runMachineAction('artifact.publish', upload, execute, noPublish)).rejects.toMatchObject({ code: 'invalid-input' });
        await expect(runMachineAction('artifact.publish', large, execute, noPublish)).rejects.toMatchObject({ code: 'limit' });
    });
});

describe('outputOf', () => {
    test('a failed action answers the code an extension reads, and one that waits on a person is refused', () => {
        expect(() => outputOf({ status: 'failed', action: 'launch.start', error: { code: 'no-launch', message: 'No launch web' } })).toThrow(
            expect.objectContaining({ code: 'not-found', message: 'No launch web' })
        );
        expect(() => outputOf({ status: 'needs_confirmation', action: 'launch.start', confirmationToken: 'token', confirmation: {} as never })).toThrow(
            expect.objectContaining({ code: 'refused' })
        );
    });
});
