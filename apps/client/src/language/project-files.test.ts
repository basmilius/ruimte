import { describe, expect, test } from 'bun:test';
import type { RequestType } from '@ruimte/contracts';
import { TextDrafts, textDrafts, type DraftLink } from '@/state/text-drafts';
import type { Transport } from '@/transport-api/transport';
import { TransportError } from '@/transport-api/transport';
import { FakeLanguageTransport } from './fake-daemon';
import { draftFiles } from './project-files';
import { RuimteProject } from './ruimte-project';

type Call = { type: RequestType; payload: unknown };

function transportOf(answer: (type: string, payload: never) => unknown): Transport {
    return {
        status: 'open',
        request: async (type: string, payload: never) => answer(type, payload),
        on: () => () => undefined,
        subscribeStatus: () => () => undefined
    } as unknown as Transport;
}

function fakeTransport(refusal?: string): { transport: Transport; calls: Call[] } {
    const calls: Call[] = [];
    const transport = transportOf((type, payload) => {
        calls.push({ type: type as RequestType, payload });
        if (refusal !== undefined) {
            throw new Error(refusal);
        }
        return {};
    });
    return { transport, calls };
}

describe('the files a workspace edit creates', () => {
    test('are made through the machine with their text', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/UserInterface.php', '<?php\n')).toBeNull();
        expect(calls).toEqual([
            { type: 'fs.create', payload: { path: '/work/src/UserInterface.php', kind: 'file', text: '<?php\n', projectId: 'p1', edits: false } }
        ]);
    });

    test('say why the machine did not make them', async () => {
        const { transport } = fakeTransport('That path is already there');
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/User.php', '')).toBe('That path is already there');
    });
});

describe('overwriting', () => {
    test('a create asks the machine to replace the file', async () => {
        const transport = new FakeLanguageTransport();
        let disk = { kind: 'text', path: '/work/src/a.php', text: 'old', mtime: 1 };
        transport.answers.set('fs.read', () => disk);
        transport.answers.set('fs.list', () => {
            throw new Error('The target is a file');
        });
        transport.answers.set('fs.create', ((payload: { text: string }) => {
            disk = { ...disk, text: payload.text, mtime: 2 };
            return { size: payload.text.length, mtime: 2 };
        }) as never);
        const drafts = new TextDrafts(() => null);
        const project = new RuimteProject(transport, 'p1', '/work', draftFiles('local', transport, 'p1', drafts));
        try {
            expect(
                await project.language.applyWorkspaceEdit({
                    documentChanges: [
                        { kind: 'create', uri: 'file:///work/src/a.php', options: { overwrite: true } },
                        {
                            textDocument: { uri: 'file:///work/src/a.php', version: null },
                            edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'new' }]
                        }
                    ]
                })
            ).toEqual({ applied: true });
            expect(transport.callsOf('fs.read').length).toBeGreaterThan(0);
            expect(transport.callsOf('fs.create')).toEqual([
                { type: 'fs.create', payload: { path: '/work/src/a.php', kind: 'file', text: 'new', projectId: 'p1', edits: false, overwrite: true } }
            ]);
            expect(disk.text).toBe('new');
        } finally {
            project.dispose();
        }
    });

    test('a rename asks the machine to replace the target and forgets the draft of what it replaced', async () => {
        const { transport, calls } = fakeTransport();
        textDrafts.stage('local', '/work/src/old.php', { text: 'old', mtime: 1 }, 'edited');
        const files = draftFiles('local', transport, 'p1');
        expect(await files.rename('/work/src/new.php', '/work/src/old.php', { overwrite: true })).toBeNull();
        expect(calls).toEqual([
            { type: 'fs.rename', payload: { path: '/work/src/new.php', to: '/work/src/old.php', projectId: 'p1', edits: false, overwrite: true } }
        ]);
        expect(textDrafts.isUnsaved('local', '/work/src/old.php')).toBe(false);
        textDrafts.discard('local', '/work/src/old.php');
    });

    test('a rename without overwrite leaves the target alone', async () => {
        const { transport, calls } = fakeTransport();
        textDrafts.stage('local', '/work/src/kept.php', { text: 'kept', mtime: 1 }, 'kept');
        expect(await draftFiles('local', transport, 'p1').rename('/work/src/a.php', '/work/src/kept.php')).toBeNull();
        expect(calls[0]!.payload).not.toHaveProperty('overwrite');
        expect(textDrafts.draft('local', '/work/src/kept.php')).toBeDefined();
        textDrafts.discard('local', '/work/src/kept.php');
    });
});

describe('the files a workspace edit deletes', () => {
    test('are deleted through the machine', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').delete!('/work/src/Old.php', { recursive: false })).toBeNull();
        expect(calls).toEqual([{ type: 'fs.delete', payload: { path: '/work/src/Old.php', projectId: 'p1', edits: false } }]);
    });

    test('say why the machine did not delete them', async () => {
        const { transport } = fakeTransport('That path is not there');
        expect(await draftFiles('local', transport, 'p1').delete!('/work/src/Old.php', { recursive: true })).toBe('That path is not there');
    });

    test('lose their unsaved draft', async () => {
        const { transport } = fakeTransport();
        textDrafts.stage('local', '/work/gone/a.php', { text: 'a', mtime: 1 }, 'b');
        const files = draftFiles('local', transport, 'p1');
        expect(files.isUnsaved!('/work/gone')).toBe(true);
        await files.delete!('/work/gone', { recursive: true });
        expect(textDrafts.isUnsaved('local', '/work/gone/a.php')).toBe(false);
        expect(files.isUnsaved!('/work/gone')).toBe(false);
    });
});

describe('unsaved work under a path', () => {
    test('counts a file and a folder holding an unsaved draft, but not a sibling with a similar name', () => {
        const { transport } = fakeTransport();
        const files = draftFiles('local', transport, 'p1');
        textDrafts.stage('local', '/work/dir/a.php', { text: 'a', mtime: 1 }, 'changed');
        textDrafts.stage('local', '/work/dir2/b.php', { text: 'b', mtime: 1 }, 'b');
        expect(files.isUnsaved!('/work/dir/a.php')).toBe(true);
        expect(files.isUnsaved!('/work/dir')).toBe(true);
        expect(files.isUnsaved!('/work/dir2')).toBe(false);
        expect(files.isUnsaved!('/work/di')).toBe(false);
        textDrafts.discard('local', '/work/dir/a.php');
        textDrafts.discard('local', '/work/dir2/b.php');
    });
});

describe('what is at a path', () => {
    test('is a folder when the machine lists it', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').isFolder!('/work/src')).toBe(true);
        expect(calls[0]).toEqual({ type: 'fs.list', payload: { path: '/work/src', depth: 1 } });
    });

    test('is nothing when the machine refuses both a read and a listing', async () => {
        const { transport } = fakeTransport('That file is not there');
        const files = draftFiles('local', transport, 'p1');
        expect(await files.isFolder!('/work/x')).toBe(false);
        expect(await files.exists!('/work/x')).toBe(false);
    });

    test('exists when the machine reads it', async () => {
        const { transport } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').exists!('/work/a.php')).toBe(true);
    });
});

describe('a file that moves and is edited while it has an unsaved draft', () => {
    /* A one-file machine whose write checks the mtime the way `fs.write` does, and whose rename keeps the mtime. */
    function fakeMachine(initial: { path: string; text: string; mtime: number }): {
        transport: Transport;
        drafts: TextDrafts;
        file: () => { path: string; text: string; mtime: number };
    } {
        const file = { ...initial };
        let clock = initial.mtime;
        const link: DraftLink = {
            read: async (path) => ({ kind: 'text', path, text: file.text, mtime: file.mtime }) as never,
            write: async (path, text, expectedMtime) => {
                if (path !== file.path || expectedMtime !== file.mtime) {
                    throw new TransportError('stale', 'The file changed');
                }
                clock += 1;
                file.text = text;
                file.mtime = clock;
                return { mtime: clock } as never;
            },
            projectOpen: async () => undefined
        };
        const transport = transportOf((type, payload: { path: string; to?: string }) => {
            if (type === 'fs.rename') {
                file.path = payload.to!;
                return {};
            }
            if (type === 'fs.read') {
                if (payload.path !== file.path) {
                    throw new Error('gone');
                }
                return { kind: 'text', path: payload.path, text: file.text, mtime: file.mtime };
            }
            return {};
        });
        return { transport, drafts: new TextDrafts(() => link), file: () => file };
    }

    test('saves the draft and the edit at the new path', async () => {
        const { transport, drafts, file } = fakeMachine({ path: '/work/moved/old.php', text: 'disk', mtime: 10 });
        drafts.stage('local', '/work/moved/old.php', { text: 'disk', mtime: 10 }, 'draft');
        const files = draftFiles('local', transport, 'p1', drafts);
        const read = (await files.read('/work/moved/old.php'))!;
        expect(await files.rename!('/work/moved/old.php', '/work/moved/new.php')).toBeNull();
        expect(await files.save!([{ path: '/work/moved/new.php', disk: read, text: 'draft edited' }])).toBeNull();
        expect(file()).toMatchObject({ path: '/work/moved/new.php', text: 'draft edited' });
        expect(drafts.isUnsaved('local', '/work/moved/new.php')).toBe(false);
    });

    test('still catches a change of the file that came after the move', async () => {
        const { transport, drafts, file } = fakeMachine({ path: '/work/moved/old.php', text: 'disk', mtime: 10 });
        drafts.stage('local', '/work/moved/old.php', { text: 'disk', mtime: 10 }, 'draft');
        const files = draftFiles('local', transport, 'p1', drafts);
        const read = (await files.read('/work/moved/old.php'))!;
        expect(await files.rename!('/work/moved/old.php', '/work/moved/new.php')).toBeNull();
        file().text = 'someone else';
        file().mtime += 5;
        expect(await files.save!([{ path: '/work/moved/new.php', disk: read, text: 'mine' }])).not.toBeNull();
        expect(file().text).toBe('someone else');
    });
});

describe('a rename that fails', () => {
    test('leaves the draft of the target alone', async () => {
        const { transport } = fakeTransport('That name is taken');
        textDrafts.stage('local', '/work/src/target.php', { text: 'target', mtime: 1 }, 'target edited');
        const message = await draftFiles('local', transport, 'p1').rename('/work/src/a.php', '/work/src/target.php', { overwrite: true });
        expect(message).toBe('That name is taken');
        expect(textDrafts.draft('local', '/work/src/target.php')?.text).toBe('target edited');
        textDrafts.discard('local', '/work/src/target.php');
    });
});

describe('overwriting a file that is open', () => {
    test('takes the draft along to what the machine wrote, so the editor text is no change', async () => {
        const transport = transportOf(() => ({ size: 3, mtime: 9 }));
        textDrafts.stage('local', '/work/src/open.php', { text: 'old', mtime: 1 }, 'old');
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/open.php', 'new', { overwrite: true })).toBeNull();
        textDrafts.edit('local', '/work/src/open.php', 'new');
        expect(textDrafts.draft('local', '/work/src/open.php')).toMatchObject({ disk: 'new', text: 'new', mtime: 9 });
        expect(textDrafts.isUnsaved('local', '/work/src/open.php')).toBe(false);
        textDrafts.discard('local', '/work/src/open.php');
    });
});
