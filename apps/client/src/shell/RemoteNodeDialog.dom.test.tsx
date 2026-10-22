import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import {
    REQUEST_SCHEMAS,
    type GitIdentity,
    type ProjectCanvasView,
    type ProjectNode,
    type ProjectSummary,
    type ProviderInfo,
    type RemoteLink,
    type RequestType
} from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { usePeerLapse } from '@/project/peer-lapse';
import { remoteMirror } from '@/transport/connections';
import { swapPeerLinker } from '@/project/peer-linker';
import { linkPeer } from '@/pulsar/peer-link';
import type { PeerStatement } from '@ruimte/pulsar';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';
const REQUEST_TYPES = Object.keys(REQUEST_SCHEMAS) as RequestType[];
const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell here', x: 0, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL], texts: [], edges: [], layouts: [] };

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true, denyReason: true, allowAlways: true, slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

function summary(projectId: string, name: string, folder: string): ProjectSummary {
    return {
        projectId,
        name,
        color: '#000',
        folder,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: name[0]! },
        nameSource: 'chosen'
    };
}

function identity(path: string, rootCommits: string[], branch = 'main'): GitIdentity {
    return { path, rootCommits, branch, heads: [] };
}

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let order: string[];
let links: RemoteLink[];
let restoreLinker: () => void;
let statementRefused: boolean;
// Holds the address book's answer, so a test can look at the window while the machines are still being linked.
let addressBookGate: Promise<void> | null;

const LINK_STEPS = ['endpoint.signPeerAccess', 'address book', 'remote.connect'];

/* What was asked of the machines, without the link between them, which goes on after the dialog is gone. */
function withoutLink(asked: string[]): string[] {
    return asked.filter((step) => !LINK_STEPS.includes(step));
}

async function openDialog(kind: 'chat' | 'terminal' | 'device' = 'chat'): Promise<void> {
    await act(async () => useUi.getState().setRemoteNodeDialog({ machineId: REMOTE, kind, viewId: 'main', at: { x: 400, y: 400 }, relink: false }));
}

function dialog(): HTMLElement | null {
    return document.querySelector('[role="dialog"]');
}

function button(text: string): HTMLElement | null {
    return ([...(dialog()?.querySelectorAll('button') ?? [])] as HTMLElement[]).find((candidate) => candidate.textContent?.includes(text)) ?? null;
}

beforeEach(async () => {
    order = [];
    links = [];
    statementRefused = false;
    addressBookGate = null;
    // The address book is the one part the page cannot reach here; the two requests to this machine are real.
    restoreLinker = swapPeerLinker((machineId, self) =>
        linkPeer({
            machineId,
            self,
            brokerUrl: null,
            request: async (payload) => {
                order.push('address book');
                await addressBookGate;
                if (statementRefused) {
                    throw new Error('Sign in first');
                }
                return {
                    machineId: payload.machineId,
                    machinePublicKey: 'B'.repeat(43),
                    accountId: 'owner',
                    peerPublicKey: payload.peerPublicKey,
                    peerMachineId: payload.peerMachineId,
                    peerMachinePublicKey: 'A'.repeat(43),
                    nonce: payload.nonce,
                    issuedAt: 1,
                    expiresAt: 2,
                    signature: 's'.repeat(86)
                } satisfies PeerStatement;
            }
        })
    );
    here = new FakeMachine();
    here.answer('endpoint.signPeerAccess', () => {
        order.push('endpoint.signPeerAccess');
        return { peerMachineId: 'machine-a', peerPublicKey: 'P'.repeat(43), peerSignature: 'p'.repeat(86), machineSignature: 'm'.repeat(86) };
    });
    here.answer('remote.connect', () => {
        order.push('remote.connect');
        return {};
    });
    here.answer('project.save', ({ baseRev }) => {
        order.push('project.save');
        return { rev: baseRev + 1 } as never;
    });
    here.answer('git.identity', () => ({ identities: [identity('/work/atlas', ['root-a'])] }));
    here.answer('remote.list', () => ({ links }));
    here.answer('remote.link', (payload) => {
        order.push('remote.link');
        const { projectId: _projectId, ...link } = payload;
        links = [link];
        return link;
    });
    there = new FakeMachine();
    there.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer('project.list', () => ({ projects: [summary('notes', 'notes', '/Users/b/notes'), summary('ruimte', 'ruimte', '/Users/b/ruimte')] }));
    there.answer('git.identity', ({ paths }) => ({
        identities: paths.map((path) => (path.endsWith('ruimte') ? identity(path, ['root-a']) : identity(path, ['root-z'])))
    }));
    there.answer('peer.bind', (payload) => {
        order.push('peer.bind');
        return { ...payload, projectName: 'ruimte', ceiling: 'supervised' as const, createdAt: 1 };
    });
    there.answer('peer.placeNodes', () => {
        order.push('peer.placeNodes');
        return {};
    });
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${SHELL.id}"]`) !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setRemoteNodeDialog(null));
    await page.unmount();
    workspace.close();
    disconnectThere();
    restoreLinker();
    usePeerLapse.setState({ lapsed: {} });
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a new node on another machine', () => {
    test('puts the checkout with the same repository on top, and says so', async () => {
        await openDialog();
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        expect(dialog()?.textContent).toContain('New chat on MacBook Pro');
        expect(dialog()?.textContent).toContain('Same repository');
        expect(dialog()?.textContent).not.toContain('Another repository');
    });

    test('offers to choose a folder when the machine has no checkout', async () => {
        there.answer('project.list', () => ({ projects: [] }));
        await openDialog();
        await until(() => dialog()?.textContent?.includes('No checkout of this repository') === true);
        expect(button('Choose a folder…')).not.toBeNull();
        expect(button('Create')?.hasAttribute('disabled')).toBe(true);
    });

    test('offers to clone the project there, and comes back to the node once it is in', async () => {
        there.answer('project.list', () => ({ projects: [] }));
        await openDialog();
        await until(() => button('Clone it on MacBook Pro…') !== null);
        const request = useUi.getState().remoteNodeDialog;
        await clickOn(button('Clone it on MacBook Pro…'));
        expect(useUi.getState().remoteNodeDialog).toBeNull();
        expect(useUi.getState().addToMachineDialog).toEqual({ machineId: REMOTE, then: request! });
        await act(async () => useUi.getState().setAddToMachineDialog(null));
    });

    test('says that the machine is not answering, and looks again on Try again', async () => {
        there.answer('project.list', () => {
            throw new Error('Connection refused');
        });
        await openDialog();
        await until(() => dialog()?.textContent?.includes('MacBook Pro is not answering.') === true);

        there.answer('project.list', () => ({ projects: [summary('ruimte', 'ruimte', '/Users/b/ruimte')] }));
        await clickOn(button('Try again'));
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
    });

    test('Create links the machine, saves the node with its machine, and only then tells the machine', async () => {
        await openDialog();
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));

        await until(() => order.includes('peer.placeNodes') && order.includes('remote.connect'));
        expect(withoutLink(order)).toEqual(['peer.bind', 'remote.link', 'project.save', 'peer.placeNodes']);
        // The two machines are linked to each other only once the node exists.
        expect(order.indexOf('endpoint.signPeerAccess')).toBeGreaterThan(order.indexOf('project.save'));
        expect(there.requests('peer.bind')[0]).toMatchObject({ projectId: 'ruimte' });
        expect(here.requests('remote.link')[0]).toMatchObject({ machineId: REMOTE, remoteProjectId: 'ruimte', rootCommit: 'root-a' });
        const saved = here.requests('project.save').at(-1)!.content.views[0] as ProjectCanvasView;
        const made = saved.nodes.find((node) => node.machine === REMOTE)!;
        expect(made).toMatchObject({ kind: 'chat', cwd: '/Users/b/ruimte', machine: REMOTE });
        expect(there.requests('peer.placeNodes')[0]).toMatchObject({ projectId: 'ruimte', nodes: [{ id: made.id, cwd: '/Users/b/ruimte' }] });
        await until(() => dialog() === null);
    });

    test('closes once the node exists, however long the account takes to vouch for the link between the machines', async () => {
        let release: () => void = () => undefined;
        addressBookGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => dialog() === null);
        await until(() => order.includes('address book'));
        // The node is saved and the dialog gone, while the link still waits on the address book.
        expect(order).toContain('project.save');
        expect(order).not.toContain('remote.connect');

        await act(async () => release());
        await until(() => order.includes('remote.connect'));
        expect(usePeerLapse.getState().lapsed[REMOTE]).toBeUndefined();
    });

    test('marks the machine when the link fails after the dialog closed, and asks the address book once', async () => {
        let release: () => void = () => undefined;
        addressBookGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        statementRefused = true;
        // The machine lists the link it made for this one without a word of the address book, which is what makes a renewal link again.
        there.answer('peer.list', () => {
            const bound = there.requests('peer.bind')[0];
            return {
                links:
                    bound === undefined
                        ? []
                        : [
                              {
                                  machineId: bound.machineId,
                                  label: 'Atlas',
                                  projectId: 'ruimte',
                                  projectName: 'ruimte',
                                  ceiling: 'supervised' as const,
                                  createdAt: 1
                              }
                          ]
            };
        });
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => dialog() === null);
        await until(() => order.includes('address book'));
        await act(async () => release());
        await until(() => usePeerLapse.getState().lapsed[REMOTE] === true && order.includes('peer.placeNodes'));
        // The next change of the canvas sends the nodes again, which asks for a renewal; a link that was just refused is not tried a second time.
        const placed = there.requests('peer.placeNodes').length;
        await act(async () => remoteMirror()?.resend(REMOTE));
        await until(() => there.requests('peer.placeNodes').length > placed);
        for (let i = 0; i < 10; i++) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
        }
        expect(order.filter((step) => step === 'address book')).toHaveLength(1);
        expect(here.requests('endpoint.signPeerAccess')).toHaveLength(1);
    });

    test('links the two machines to each other after the link of the project, and hands the statement and the broker of the account to this machine', async () => {
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => order.includes('peer.placeNodes') && order.includes('remote.connect'));
        expect(here.requests('endpoint.signPeerAccess')[0]).toMatchObject({ machineId: REMOTE });
        expect(here.requests('remote.connect')[0]).toMatchObject({ machineId: REMOTE, statement: { machineId: REMOTE } });
        expect(usePeerLapse.getState().lapsed[REMOTE]).toBeUndefined();
    });

    test('still makes the node when the account cannot vouch for the link, and marks the machine so the node offers the way back', async () => {
        statementRefused = true;
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => order.includes('peer.placeNodes') && usePeerLapse.getState().lapsed[REMOTE] === true);
        expect(here.requests('remote.connect')).toEqual([]);
        expect(here.requests('project.save').length).toBeGreaterThan(0);
    });

    test('leaves the machines unlinked when this machine runs a Ruimte that cannot link them', async () => {
        await act(async () => here.answersOnly(['project.save', 'git.identity', 'remote.list', 'remote.link', 'project.list']));
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => order.includes('peer.placeNodes'));
        expect(here.requests('endpoint.signPeerAccess')).toEqual([]);
        expect(usePeerLapse.getState().lapsed[REMOTE]).toBeUndefined();
    });

    test('leaves the machines unlinked when the other machine runs a Ruimte that takes no tasks from this one', async () => {
        await act(async () => there.answersOnly(REQUEST_TYPES.filter((type) => type !== 'peer.taskStart')));
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => order.includes('peer.placeNodes'));
        await until(() => dialog() === null);
        expect(here.requests('endpoint.signPeerAccess')).toEqual([]);
        expect(order).not.toContain('address book');
        expect(usePeerLapse.getState().lapsed[REMOTE]).toBeUndefined();
    });

    test('Create with your files here bundles them here, sends them, and makes the worktree before the node is saved', async () => {
        here.answer(
            'git.status',
            () => ({ repo: true, branch: 'main', detached: false, upstream: null, files: [{ path: 'a.txt' }, { path: 'b.txt' }] }) as never
        );
        here.answer('git.bundle', () => {
            order.push('git.bundle');
            return { bundleId: 'bundle-one', size: 5, sha256: 'a'.repeat(64), commit: 'c1', base: null };
        });
        here.answer('bytes.read', ({ offset }) => ({ mime: 'application/x-git-bundle', size: 5, version: 'v1', offset, data: btoa('hello') }));
        there.answer('git.bundlePut', ({ offset }) => {
            order.push('git.bundlePut');
            return { received: offset + 5 };
        });
        there.answer('git.fetchBundle', () => {
            order.push('git.fetchBundle');
            return { path: '/Users/b/worktrees/ruimte/main', branch: 'ruimte/main', commit: 'c1' };
        });
        await openDialog();
        await until(() => dialog()?.textContent?.includes('Your files here (main, 2 changed)') === true);
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));

        await until(() => order.includes('peer.placeNodes'));
        expect(withoutLink(order)).toEqual(['peer.bind', 'remote.link', 'git.bundle', 'git.bundlePut', 'git.fetchBundle', 'project.save', 'peer.placeNodes']);
        expect(here.requests('git.bundle')[0]).toMatchObject({ path: '/work/atlas', from: 'files' });
        expect(there.requests('git.fetchBundle')[0]).toMatchObject({ projectId: 'ruimte', bundleId: 'bundle-one', sha256: 'a'.repeat(64), into: 'worktree' });
        expect(there.requests('peer.placeNodes')[0]).toMatchObject({ nodes: [{ cwd: '/Users/b/worktrees/ruimte/main' }] });
    });

    test('offers the branch on origin only when both checkouts have one', async () => {
        here.answer('git.status', () => ({ repo: true, branch: 'main', detached: false, upstream: null, files: [] }) as never);
        here.answer('git.identity', () => ({ identities: [{ ...identity('/work/atlas', ['root-a']), remoteUrl: 'git@host:atlas.git' }] }));
        await openDialog();
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        await until(() => dialog()?.textContent?.includes('As it is on MacBook Pro') === true);
        await clickOn(dialog()?.querySelector('[aria-label="Start from"]') ?? null);
        await until(() => document.querySelector('[role="option"]') !== null);
        const labels = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
        expect(labels).toContain('HEAD here (main)');
        expect(labels).not.toContain('A branch on origin');
        expect(labels.some((label) => label?.startsWith('Your files here'))).toBe(false);
    });

    test('a branch on origin is pushed here, fetched there, and the worktree starts on it', async () => {
        here.answer('git.status', () => ({ repo: true, branch: 'main', detached: false, upstream: 'origin/main', files: [] }) as never);
        here.answer('git.identity', () => ({ identities: [{ ...identity('/work/atlas', ['root-a']), remoteUrl: 'git@host:atlas.git' }] }));
        there.answer('git.identity', ({ paths }) => ({
            identities: paths.map((path) => ({ ...identity(path, [path.endsWith('ruimte') ? 'root-a' : 'root-z']), remoteUrl: 'git@host:atlas.git' }))
        }));
        here.answer('git.action', ({ kind }) => {
            order.push(`here ${kind}`);
            return { actionId: 'a', summary: '', output: '' };
        });
        there.answer('git.action', ({ kind }) => {
            order.push(`there ${kind}`);
            return { actionId: 'a', summary: '', output: '' };
        });
        there.answer('git.worktree-add', () => {
            order.push('git.worktree-add');
            return { worktree: { path: '/Users/b/worktrees/ruimte/main', branch: 'ruimte/main' }, created: true } as never;
        });
        await openDialog();
        await until(() => dialog()?.textContent?.includes('As it is on MacBook Pro') === true);
        await clickOn(dialog()?.querySelector('[aria-label="Start from"]') ?? null);
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === 'A branch on origin') ?? null);
        await until(() => dialog()?.textContent?.includes('Pushes main to origin from here') === true);
        await clickOn(button('Create'));

        await until(() => order.includes('peer.placeNodes'));
        expect(withoutLink(order)).toEqual(['peer.bind', 'remote.link', 'here push', 'there fetch', 'git.worktree-add', 'project.save', 'peer.placeNodes']);
        expect(there.requests('git.worktree-add')[0]).toMatchObject({ repo: '/Users/b/ruimte', branch: 'ruimte/main', base: 'origin/main' });
    });

    test('a link that is refused leaves the canvas as it was', async () => {
        there.answer('peer.bind', () => {
            throw new Error('That project is not on this machine');
        });
        await openDialog();
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));
        await until(() => dialog()?.textContent?.includes('That project is not on this machine') === true);
        expect(here.requests('remote.link')).toEqual([]);
        expect(here.requests('project.save')).toEqual([]);
        expect(there.requests('peer.placeNodes')).toEqual([]);
    });
});

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}

async function openCanvasMenu(): Promise<void> {
    const surface = page.host.querySelector('[data-canvas-surface]')!;
    await act(async () => {
        surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
    await openSubmenu('On another machine');
}

describe('linking a machine again', () => {
    /* A chat that works on the other machine in `cwd`, under a link to `remoteProjectId` there. */
    async function farChat(remoteProjectId: string, cwd: string): Promise<void> {
        links = [{ machineId: REMOTE, remoteProjectId, label: 'MacBook Pro', rootCommit: 'root-a' }];
        there.answer('project.release', () => {
            order.push('project.release');
            return {};
        });
        await act(async () => {
            defaultCanvases.peek('main')!.getState().addNode('chat', { x: 600, y: 0 }, { machine: REMOTE, cwd, provider: 'claude', providerFixed: true });
        });
        await until(() => there.requests('peer.placeNodes').some((request) => request.projectId === remoteProjectId && request.nodes.length === 1));
        order = [];
    }

    async function openRelink(): Promise<void> {
        await act(async () => useUi.getState().setRemoteNodeDialog({ machineId: REMOTE, kind: 'chat', viewId: 'main', at: null, relink: true }));
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        await until(() => button('Link')?.hasAttribute('disabled') === false);
    }

    test('to the same folder under a new project there lets the old project go and places the nodes in the new one', async () => {
        await farChat('ruimte-before', '/Users/b/ruimte');
        await openRelink();
        await clickOn(button('Link'));

        await until(() => dialog() === null);
        await until(() => there.requests('peer.placeNodes').some((request) => request.projectId === 'ruimte'));
        expect(here.requests('remote.link').at(-1)).toMatchObject({ remoteProjectId: 'ruimte' });
        expect(there.requests('project.release').map((request) => request.projectId)).toEqual(['ruimte-before']);
        expect(there.requests('peer.placeNodes').at(-1)).toMatchObject({ projectId: 'ruimte', nodes: [{ cwd: '/Users/b/ruimte' }] });
    });

    test('to another folder is refused while the nodes there work in the checkout they had', async () => {
        await farChat('ruimte-before', '/Users/b/ruimte-before');
        await openRelink();
        await clickOn(button('Link'));

        await until(() => dialog()?.textContent?.includes('The nodes on MacBook Pro work in /Users/b/ruimte-before.') === true);
        expect(here.requests('remote.link')).toEqual([]);
        expect(there.requests('peer.bind')).toEqual([]);
        expect(there.requests('peer.placeNodes').every((request) => request.projectId === 'ruimte-before')).toBe(true);
    });
});

describe('the canvas menu', () => {
    test('offers every other machine below the node kinds, and a click opens the dialog for it', async () => {
        await openCanvasMenu();
        expect(document.querySelector('[role="menu"]')?.textContent).toContain('On another machine');
        await clickOn(menuItem('MacBook Pro'));
        expect(useUi.getState().remoteNodeDialog).toMatchObject({ machineId: REMOTE, kind: 'chat', viewId: 'main', relink: false });
    });

    test('offers to add the project to another machine below them', async () => {
        await openCanvasMenu();
        await clickOn(menuItem('Add to another machine'));
        expect(useUi.getState().addToMachineDialog).toEqual({ machineId: null });
        await act(async () => useUi.getState().setAddToMachineDialog(null));
    });

    test('says it is off on a shared canvas, since a node of another machine stays on a canvas only you have', async () => {
        await act(async () => useDocument.getState().setShared('main', true));
        await openCanvasMenu();
        expect(menuItem('MacBook Pro')?.getAttribute('aria-disabled')).toBe('true');
        await act(async () => useDocument.getState().setShared('main', false));
    });

    test('says a machine that is not answering, and one that runs an older Ruimte', async () => {
        await act(async () => there.lose());
        await openCanvasMenu();
        expect(menuItem('MacBook Pro')?.textContent).toContain('Not answering');
        expect(menuItem('MacBook Pro')?.getAttribute('aria-disabled')).not.toBe('true');
    });

    test('keeps a machine that runs an older Ruimte off, and says what it needs', async () => {
        await act(async () => there.answersOnly(['project.list', 'git.identity']));
        await openCanvasMenu();
        expect(menuItem('MacBook Pro')?.textContent).toContain('Needs an update');
        expect(menuItem('MacBook Pro')?.getAttribute('aria-disabled')).toBe('true');
    });
});
