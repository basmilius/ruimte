import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppleFoundationRequestSchema } from '@ruimte/contracts';
import { appleProvider } from '../providers/apple-provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AppleBackend } from './apple-backend.ts';
import { AttachmentStore } from '@ruimte/agents/chat/attachment-store';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder, RecordingStore } from './chat-test-helpers.ts';
import { inProcess } from '@ruimte/agents/chat/fake-cli';

test('Apple chat projects approved directory and file tools across turns into its saved thread', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-apple-chat-'));
    await writeFile(join(home, 'project-notes.txt'), 'The project code is ORCHID.');
    const attachments = new AttachmentStore(home);
    const store = new RecordingStore(home, { attachments });
    const recorder = new ChatRecorder();
    let nativeTurn = '';
    let nativeSession = '';
    const helper = inProcess((io) => {
        io.out({ type: 'availability', available: true });
        nativeSession = io.argv[io.argv.indexOf('--session') + 1]!;
        io.out({ type: 'session', protocolVersion: 3, id: nativeSession, restored: false });
        return {
            onLine: (line) => {
                const request = AppleFoundationRequestSchema.parse(JSON.parse(line));
                if (request.type === 'turn') {
                    nativeTurn = request.id;
                    if (request.prompt.includes('Read project-notes.txt')) {
                        io.out({ type: 'tool.call', id: `${request.id}-tool-1`, name: 'read_file', path: 'project-notes.txt', offset: 0 });
                    } else {
                        io.out({ type: 'tool.call', id: `${request.id}-tool-1`, name: 'list_files', path: '.' });
                    }
                } else if (request.type === 'tool.result') {
                    io.out({ type: 'text.snapshot', id: nativeTurn, text: `The result is ${request.output}.` });
                    io.out({ type: 'done', id: nativeTurn, state: 'done' });
                }
            }
        };
    });
    const provider = {
        ...appleProvider,
        createBackend: (launch: ConstructorParameters<typeof AppleBackend>[0], host: ConstructorParameters<typeof AppleBackend>[1]) =>
            new AppleBackend(launch, host)
    };
    const manager = new ChatManager({
        providers: new ProviderRegistry({ providers: [provider] }),
        store,
        attachments,
        spawn: helper.spawn,
        env: { HOME: home, RUIMTE_HOME: home }
    });
    try {
        manager.subscribe('apple-client', recorder.sink());
        const info = await manager.create({ chatId: 'apple-chat', provider: 'apple', cwd: home });
        expect(info.agentSessionId).toBeNull();
        manager.attach('apple-chat', 'apple-client');
        await manager.send('apple-chat', 'List the project files.');
        await recorder.until(() => recorder.info?.status === 'needs-you');
        expect(recorder.ofKind('approval')).toHaveLength(1);
        manager.approve('apple-chat', `${nativeTurn}-tool-1`, 'allow');
        await recorder.until(() => recorder.info?.status === 'idle' && recorder.info.activeTurnId === null);
        expect(recorder.ofKind('tool')[0]).toMatchObject({ name: 'ListFiles', state: 'done' });
        expect(recorder.ofKind('tool')[0]?.output).toContain('project-notes.txt');
        expect(recorder.ofKind('assistant')[0]?.text).toContain('project-notes.txt');
        expect(recorder.ofKind('assistant')[0]?.streaming).toBe(false);
        expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'done' });
        expect(recorder.info?.agentSessionId).toBe(nativeSession);
        expect(recorder.ofKind('note').some((item) => item.text.includes('conversation memory'))).toBe(true);
        await manager.send('apple-chat', 'Read project-notes.txt.');
        await recorder.until(() => recorder.info?.status === 'needs-you');
        expect(recorder.ofKind('approval')).toHaveLength(2);
        manager.approve('apple-chat', `${nativeTurn}-tool-1`, 'allow');
        await recorder.until(() => recorder.info?.status === 'idle' && recorder.info.activeTurnId === null);
        expect(recorder.ofKind('tool')[1]?.output).toContain('ORCHID');
        expect(recorder.ofKind('assistant')[1]?.text).toContain('ORCHID');
        expect(recorder.ofKind('turn').map((item) => item.state)).toEqual(['done', 'done']);
        expect(recorder.ofKind('note').filter((item) => item.text.includes('conversation memory'))).toHaveLength(1);
    } finally {
        await manager.shutdown();
        await manager.get('apple-chat')?.dispose();
        await rm(home, { recursive: true, force: true });
    }
});
