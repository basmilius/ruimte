import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ManualClock } from '@adecore/agents/testing';
import { EXTENSION_API_VERSION, type ProjectContent } from '@ruimte/contracts';
import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { extensionChatStarter } from './extension-chat.ts';
import { ExtensionHost } from './extension-host.ts';
import { ExtensionStore } from './store.ts';

/*
 * An extension's chat start as the daemon wires it: the daemon's own callback, the real action registry and the test
 * daemon behind it, with fake CLIs and no wall clock.
 */

const ID = 'acme.starter';

const CONTENT = {
    name: 'Shop',
    color: '#123456',
    views: [{ kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] }]
} as ProjectContent;

function packOf(permissions: Record<string, string>): string {
    const manifest = JSON.stringify({ id: ID, name: 'Starter', version: '0.1.0', api: EXTENSION_API_VERSION, permissions });
    const files = { 'manifest.json': Buffer.from(manifest).toString('base64') };

    return gzipSync(JSON.stringify({ files })).toString('base64');
}

let root: string;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-extension-chat-'));

    const folder = join(root, 'shop');

    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks());

    const opened = await store.openProject({ folder });

    await store.save(opened.summary.projectId, opened.document.rev, CONTENT);
    store.release(opened.summary.projectId);
    projectId = opened.summary.projectId;
    daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock() });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function extensionOn(host: CanvasHost): Promise<ExtensionHost> {
    const extensions = new ExtensionStore(join(root, 'home'));
    const starter = extensionChatStarter({ host, actions: serverActions, folderOf: (id) => store.index.folderOf(id) });
    const extensionHost = new ExtensionHost({ store: extensions, startChat: starter });

    await extensions.install(packOf({ 'agents.start': 'Starts a chat' }));

    return extensionHost;
}

async function nodesOnCanvas(): Promise<string[]> {
    const canvas = (await store.read(projectId)).views.find((view) => view.id === 'main');

    return canvas?.kind === 'canvas' ? canvas.nodes.map((node) => node.id) : [];
}

describe('an extension starts a chat', () => {
    test('on the canvas, as an AI Chat under the CLI of the machine, supervised at most', async () => {
        const extensions = await extensionOn(daemon.host);
        const { nodeId } = await extensions.startAgent(ID, { projectId, viewId: 'main', prompt: 'Hello', title: 'Helper' });

        expect(await nodesOnCanvas()).toEqual([nodeId]);
        expect(daemon.enqueued.find((work) => work.kind === 'start-agent')).toMatchObject({
            payload: { node: 'chat', provider: 'claude', ceiling: 'supervised' }
        });
    });

    test('makes nothing once it is turned off while the start waits in the action', async () => {
        const starts = daemon.host.starts;
        let asked = 0;
        let reached = (): void => undefined;
        let release = (): void => undefined;
        const waiting = new Promise<void>((resolve) => (reached = resolve));
        const held = new Promise<void>((resolve) => (release = resolve));
        // The daemon's callback asks first; the second ask is the action's own, after the callback checked.
        const gated = new Proxy(starts, {
            get: (target, property, receiver) =>
                property === 'installedAgents'
                    ? async () => {
                          asked += 1;

                          if (asked === 2) {
                              reached();
                              await held;
                          }

                          return target.installedAgents();
                      }
                    : Reflect.get(target, property, receiver)
        });
        const host = new Proxy(daemon.host, {
            get: (target, property, receiver) => (property === 'starts' ? gated : Reflect.get(target, property, receiver))
        });
        const extensions = await extensionOn(host);
        const starting = extensions.startAgent(ID, { projectId, viewId: 'main', prompt: 'Hello' });

        await waiting;
        await extensions.setEnabled(ID, false);
        release();

        await expect(starting).rejects.toMatchObject({ code: 'unavailable' });
        expect(await nodesOnCanvas()).toEqual([]);
        expect(daemon.enqueued.filter((work) => work.kind === 'start-agent')).toEqual([]);
    });

    test.each(['the project write', 'the lineage write', 'the prompt hold'] as const)(
        'takes its node away again once it is turned off during %s, with no lineage, no held prompt and no start',
        async (step) => {
            let reached = (): void => undefined;
            let release = (): void => undefined;
            const waiting = new Promise<void>((resolve) => (reached = resolve));
            const held = new Promise<void>((resolve) => (release = resolve));
            let nodeId = '';
            // The step is under way, or for the project write done, when the extension is turned off.
            const during = async (node: string, work: Promise<void>): Promise<void> => {
                nodeId = node;
                reached();
                await held;
                await work;
            };
            const { projects, lineage, starts } = daemon.host;
            const gated: CanvasHost = {
                ...daemon.host,
                projects: withMethod(projects, 'mutate', (id: string, apply: Parameters<CanvasHost['projects']['mutate']>[1]) =>
                    projects.mutate(id, async (content) => {
                        const mutation = await apply(content);
                        const { landed, result } = mutation;
                        const node = (result as { output?: { nodeId?: string } } | undefined)?.output?.nodeId;

                        return step !== 'the project write' || landed === undefined || node === undefined
                            ? mutation
                            : { ...mutation, landed: () => during(node, Promise.resolve()).then(landed) };
                    })
                ),
                lineage: withMethod(lineage, 'put', (record: Parameters<CanvasHost['lineage']['put']>[0]) =>
                    step === 'the lineage write' ? during(record.nodeId, lineage.put(record)) : lineage.put(record)
                ),
                starts: withMethod(starts, 'holdPrompt', (...args: Parameters<CanvasHost['starts']['holdPrompt']>) =>
                    step === 'the prompt hold' ? during(args[1], starts.holdPrompt(...args)) : starts.holdPrompt(...args)
                )
            };
            const extensions = await extensionOn(gated);
            const starting = extensions.startAgent(ID, { projectId, viewId: 'main', prompt: 'Hello' });

            await waiting;
            await extensions.setEnabled(ID, false);
            release();

            await expect(starting).rejects.toMatchObject({ code: 'unavailable' });
            expect(nodeId).not.toBe('');
            expect(await nodesOnCanvas()).toEqual([]);
            expect(daemon.lineage.projectOf(nodeId)).toBeNull();
            expect(daemon.prompts.has(nodeId)).toBe(false);
            expect(daemon.enqueued.filter((work) => work.kind === 'start-agent')).toEqual([]);
        }
    );

    test.each([
        [
            'its removal fails',
            'chat',
            async (): Promise<void> => {
                throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
            }
        ],
        [
            'a person replaced it with a note first',
            'note',
            async (nodeId: string): Promise<void> => {
                await daemon.host.projects.mutate(projectId, (content) => ({
                    content: {
                        ...content,
                        views: content.views.map((view) =>
                            view.kind === 'canvas'
                                ? { ...view, nodes: [{ id: nodeId, kind: 'note', title: 'Mine', x: 0, y: 0, w: 320, h: 240 }], edges: [] }
                                : view
                        )
                    },
                    result: undefined
                }));
            }
        ]
    ] as const)('fails naming the node it leaves once it is turned off after the write and %s', async (_, kind, beforeRollback) => {
        let reached = (): void => undefined;
        let release = (): void => undefined;
        const waiting = new Promise<void>((resolve) => (reached = resolve));
        const held = new Promise<void>((resolve) => (release = resolve));
        let nodeId = '';
        const { projects, lineage } = daemon.host;
        const gated: CanvasHost = {
            ...daemon.host,
            // Once the node is written, the next change of the project is the one that takes it away again.
            projects: withMethod(projects, 'mutate', async (id: string, apply: Parameters<CanvasHost['projects']['mutate']>[1]) => {
                if (nodeId !== '') {
                    await beforeRollback(nodeId);
                }

                return projects.mutate(id, apply);
            }),
            lineage: withMethod(lineage, 'put', async (record: Parameters<CanvasHost['lineage']['put']>[0]) => {
                nodeId = record.nodeId;
                reached();
                await held;
                await lineage.put(record);
            })
        };
        const extensions = await extensionOn(gated);
        const starting = extensions.startAgent(ID, { projectId, viewId: 'main', prompt: 'Hello' });

        await waiting;
        await extensions.setEnabled(ID, false);
        release();

        const failure = await starting.then(
            () => null,
            (e: unknown) => e
        );
        const canvas = (await store.read(projectId)).views.find((view) => view.id === 'main');

        expect(failure).toMatchObject({ code: 'failed', message: expect.stringContaining(nodeId) });
        expect(canvas?.kind === 'canvas' ? canvas.nodes.map((node) => [node.id, node.kind]) : []).toEqual([[nodeId, kind]]);
        expect(daemon.enqueued.filter((work) => work.kind === 'start-agent')).toEqual([]);
    });
});

/* `target` with one method in place of its own, the rest of it as it is. */
function withMethod<Target extends object>(target: Target, name: keyof Target, method: unknown): Target {
    return new Proxy(target, {
        get: (object, property, receiver) => (property === name ? method : Reflect.get(object, property, receiver))
    });
}
