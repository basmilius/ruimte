import { describe, expect, it } from 'bun:test';
import { renamesTaken } from './file-operations.ts';
import { flush, sessionWith } from './test-transport.ts';

const user = { oldUri: 'file:///work/src/Models/User.php', newUri: 'file:///work/src/Domain/User.php', directory: false };
const models = { oldUri: 'file:///work/src/Models', newUri: 'file:///work/src/Entities', directory: true };

describe('the filters of a file operation', () => {
    it('take a file or a folder by what the filter says it matches', () => {
        const filters = [
            { scheme: 'file', pattern: { glob: '**/*.php', matches: 'file' as const } },
            { scheme: 'file', pattern: { glob: '**', matches: 'folder' as const } }
        ];
        expect(renamesTaken(filters, [user, models])).toEqual([
            { oldUri: user.oldUri, newUri: user.newUri },
            { oldUri: models.oldUri, newUri: models.newUri }
        ]);
        expect(renamesTaken(filters.slice(0, 1), [user, models])).toEqual([{ oldUri: user.oldUri, newUri: user.newUri }]);
        expect(renamesTaken([{ pattern: { glob: '**/*.php' } }], [models])).toEqual([]);
    });

    it('leave out a file of another kind, another scheme or another case', () => {
        expect(renamesTaken([{ pattern: { glob: '**/*.ts' } }], [user])).toEqual([]);
        expect(renamesTaken([{ scheme: 'untitled', pattern: { glob: '**' } }], [user])).toEqual([]);
        expect(renamesTaken([{ pattern: { glob: '**/*.PHP' } }], [user])).toEqual([]);
        expect(renamesTaken([{ pattern: { glob: '**/*.PHP', options: { ignoreCase: true } } }], [user])).toHaveLength(1);
    });

    it('name the file by its decoded path', () => {
        const spaced = { oldUri: 'file:///work/My%20Files/a.php', newUri: 'file:///work/My%20Files/b.php', directory: false };
        expect(renamesTaken([{ pattern: { glob: '**/My Files/*.php' } }], [spaced])).toHaveLength(1);
    });
});

describe('telling a server about renamed files', () => {
    it('declares what the host does before any server registers', async () => {
        const { transport, session } = await sessionWith({});
        const { capabilities } = transport.request('initialize').params as { capabilities: { workspace: Record<string, unknown> } };
        expect(capabilities.workspace.workspaceEdit).toMatchObject({ documentChanges: true, resourceOperations: ['rename'] });
        expect(capabilities.workspace.fileOperations).toEqual({ dynamicRegistration: true, willRename: true, didRename: true });
        await session.shutdown();
    });

    it('asks for the edit of the files its capabilities take, and nothing for the others', async () => {
        const { transport, session } = await sessionWith({
            workspace: { fileOperations: { willRename: { filters: [{ scheme: 'file', pattern: { glob: '**/*.php', matches: 'file' } }] } } }
        });
        const asked = session.willRenameFiles([user, { ...user, oldUri: 'file:///work/a.txt', newUri: 'file:///work/b.txt' }]);
        await flush();
        expect(transport.request('workspace/willRenameFiles').params).toEqual({ files: [{ oldUri: user.oldUri, newUri: user.newUri }] });
        const edit = { documentChanges: [] };
        transport.respond('workspace/willRenameFiles', edit);
        expect(await asked).toEqual(edit);
        expect(await session.willRenameFiles([{ ...user, oldUri: 'file:///work/a.txt' }])).toBeNull();
        await session.shutdown();
    });

    it('takes the filters of a registration too, and lets go of them again', async () => {
        const { transport, session } = await sessionWith({});
        expect(await session.willRenameFiles([user])).toBeNull();
        transport.emit({
            jsonrpc: '2.0',
            id: 200,
            method: 'client/registerCapability',
            params: {
                registrations: [{ id: 'rename', method: 'workspace/willRenameFiles', registerOptions: { filters: [{ pattern: { glob: '**/*.php' } }] } }]
            }
        });
        await flush();
        expect(session.fileOperationFilters('willRename')).toHaveLength(1);
        expect(session.fileOperationFilters('didRename')).toEqual([]);
        transport.emit({
            jsonrpc: '2.0',
            id: 201,
            method: 'client/unregisterCapability',
            params: { unregisterations: [{ id: 'rename', method: 'workspace/willRenameFiles' }] }
        });
        await flush();
        expect(session.fileOperationFilters('willRename')).toEqual([]);
        await session.shutdown();
    });

    it('notifies only of what its filters take', async () => {
        const { transport, session } = await sessionWith({ workspace: { fileOperations: { didRename: { filters: [{ pattern: { glob: '**/*.php' } }] } } } });
        await session.didRenameFiles([user, models]);
        expect(transport.sent).toContainEqual({
            jsonrpc: '2.0',
            method: 'workspace/didRenameFiles',
            params: { files: [{ oldUri: user.oldUri, newUri: user.newUri }] }
        });
        await session.didRenameFiles([models]);
        expect(transport.sent.filter((message) => 'method' in message && message.method === 'workspace/didRenameFiles')).toHaveLength(1);
        await session.shutdown();
    });
});
