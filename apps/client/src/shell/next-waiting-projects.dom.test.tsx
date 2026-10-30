import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import { projectSidebarViews, type ChatInfo, type ProjectSummary, type ProjectView } from '@ruimte/contracts';
import { usePromptFront } from '@/canvas/prompt-stack';
import { isApplePlatform } from '@/desktop/bridge';
import { projectSwitch } from '@/project/open';
import { startWindowTabs, useWindowTabs } from '@/project/window-tabs';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useSettings } from '@/state/settings';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { startWaitingSinceWatch, useWaitingSince } from '@/state/waiting';
import { dropMachine } from '@/transport/connections';
import { chatInfoOf } from '../../testing/chat-info';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { emptyCanvas, projectSummary } from '../../testing/project-fixtures';
import { nextWaitingTitle } from './next-waiting';
import { sidebarMachineSnapshot } from './sidebar-projects';

const ENDPOINT = 'fake-machine';
const REMOTE = 'wait-remote-machine';
const NOW = Date.UTC(2026, 9, 30, 10);
const HERE = projectSummary('project-atlas', 'Atlas', '/work/atlas');
const THERE = projectSummary('wait-borealis', 'Borealis', '/work/borealis');
const MAIN = emptyCanvas();
const OTHER = emptyCanvas('other-main', 'Other canvas');
const previousNavigation = useSettings.getState().projectNavigation;
const previousScope = useSettings.getState().sidebarScope;

let machine: FakeMachine;
let newer: ProjectView;
let older: ProjectView;
let workspace: FakeWorkspace;
let page: Mounted;
let stopTabs: () => void;
let infos: Record<string, ChatInfo>;
let run = 0;
let disconnectRemote: (() => void) | null;
let stopWaiting: () => void;

function response(summary: ProjectSummary, views: ProjectView[]) {
    return {
        summary,
        document: { version: 3 as const, rev: 1, name: summary.name, color: summary.color, views },
        local: { activeViewId: views[0]!.id, views: {} }
    };
}

function opened(projectId: string) {
    return projectId === HERE.projectId ? response(HERE, [MAIN, newer]) : response(THERE, [OTHER, older]);
}

function waiting(chatId: string, createdAt: number): ChatInfo {
    return chatInfoOf(chatId, {
        status: 'needs-you',
        requests: [{ requestId: `request-${chatId}`, itemId: `item-${chatId}`, kind: 'approval', createdAt }]
    });
}

async function next(): Promise<void> {
    const apple = isApplePlatform();
    await pressKey(document.body, 'p', { altKey: true, metaKey: apple, ctrlKey: !apple });
}

function showing(projectId: string, nodeId: string): boolean {
    return useProject.getState().current?.projectId === projectId && usePromptFront.getState().request?.nodeId === nodeId;
}

beforeEach(async () => {
    disconnectRemote = null;
    localStorage.clear();
    setSystemTime(NOW);
    stopWaiting = startWaitingSinceWatch();
    const since = NOW - 60 * 60_000 + ++run * 60_000;
    newer = { kind: 'chat', id: `tab-newer-${run}`, name: 'Current review', node: {} };
    older = { kind: 'chat', id: `tab-older-${run}`, name: 'Background review', node: {} };
    infos = { [newer.id]: waiting(newer.id, since + 20_000), [older.id]: waiting(older.id, since) };
    machine = new FakeMachine();
    machine.answer('chat.list', () => ({ chats: Object.values(infos) }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: [] }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN, newer] }, { activeViewId: MAIN.id, views: {} });
    machine.answer('project.open', ({ projectId }) => opened(projectId!));
    machine.answer('project.list', () => ({ projects: [HERE, THERE] }));
    machine.answer('project.sidebar', () => ({
        projects: [
            { summary: HERE, views: projectSidebarViews([MAIN, newer], []) },
            { summary: THERE, views: projectSidebarViews([OTHER, older], []) }
        ]
    }));
    useProjectList.getState().setProjects(ENDPOINT, [HERE, THERE]);
    history.replaceState(null, '', `?state=${encodeURIComponent(JSON.stringify([`${ENDPOINT}:${HERE.projectId}`, `${ENDPOINT}:${THERE.projectId}`]))}`);
    useSettings.setState({ projectNavigation: 'tabs', sidebarScope: 'current' });
    stopTabs = startWindowTabs();
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-tab-key="${ENDPOINT}:${THERE.projectId}"] [aria-label="1 waiting"]`) !== null);
    await act(async () => usePromptFront.setState({ request: null }));
});

afterEach(async () => {
    await page.unmount();
    stopTabs();
    workspace.close();
    stopWaiting();
    dropMachine(REMOTE);
    disconnectRemote?.();
    useEndpoints.getState().remove(REMOTE);
    useSettings.setState({ projectNavigation: previousNavigation, sidebarScope: previousScope });
    useSnoozes.getState().receive(ENDPOINT, []);
    history.replaceState(null, '', location.pathname);
    setSystemTime();
});

describe("next wait across this window's project tabs", () => {
    test('visits the older background wait, advances to the current project and wraps', async () => {
        const reads = machine.requests('project.sidebar').length;
        expect(nextWaitingTitle()).toBe('Borealis / Background review');
        await next();
        await until(() => showing(THERE.projectId, older.id));
        await until(() => page.host.querySelector(`[data-split-cell][data-view-id="${older.id}"]`) !== null);
        await next();
        await until(() => showing(HERE.projectId, newer.id));
        await next();
        await until(() => showing(THERE.projectId, older.id));
        expect(machine.requests('project.sidebar')).toHaveLength(reads);
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('a snoozed background wait is skipped without opening its project', async () => {
        await act(async () => useSnoozes.getState().receive(ENDPOINT, [{ nodeId: older.id, until: NOW + 60_000 }]));
        const opens = machine.requests('project.open').length;
        expect(nextWaitingTitle()).toBe('Current review');
        await next();
        await until(() => showing(HERE.projectId, newer.id));
        expect(machine.requests('project.open')).toHaveLength(opens);
    });

    test('an offline background snapshot is skipped and reading the next title starts no request', async () => {
        await act(async () => machine.drop());
        await until(() => sidebarMachineSnapshot(ENDPOINT)?.state === 'offline');
        const reads = machine.sent.length;
        expect(nextWaitingTitle()).toBe('Current review');
        expect(machine.sent).toHaveLength(reads);
    });

    test('equal project and chat ids on two machines remain two destinations', async () => {
        const remote = new FakeMachine();
        const remoteProject = { ...HERE, name: 'Remote Atlas', folder: '/remote/atlas' };
        const remoteChat: ProjectView = { ...newer, name: 'Remote approval' };
        const remoteMain = emptyCanvas('remote-main', 'Remote canvas');
        const info = waiting(newer.id, infos[older.id]!.requests![0]!.createdAt - 1_000);
        remote.answer('chat.list', () => ({ chats: [info] }));
        remote.answer('chat.attach', () => ({ info, items: [] }));
        remote.answer('project.open', () => response(remoteProject, [remoteMain, remoteChat]));
        remote.answer('project.list', () => ({ projects: [remoteProject] }));
        remote.answer('project.sidebar', () => ({ projects: [{ summary: remoteProject, views: projectSidebarViews([remoteMain, remoteChat], []) }] }));
        await act(async () => {
            useEndpoints.getState().add({
                id: REMOTE,
                label: 'Review machine',
                httpBaseUrl: 'http://127.0.0.1:2',
                wsBaseUrl: 'ws://127.0.0.1:2',
                reachability: 'lan',
                daemonId: null,
                daemonPublicKey: null
            });
            disconnectRemote = connectFakeMachine(remote, REMOTE);
            useProjectList.getState().setProjects(REMOTE, [remoteProject]);
            useWindowTabs.setState({
                tabs: { keys: [`${ENDPOINT}:${HERE.projectId}`, `${REMOTE}:${HERE.projectId}`], active: `${ENDPOINT}:${HERE.projectId}` }
            });
        });
        await until(() => sidebarMachineSnapshot(REMOTE)?.state === 'ready');
        expect(nextWaitingTitle()).toBe('Remote Atlas / Remote approval');
        await next();
        await until(() => useProject.getState().currentEndpointId === REMOTE && showing(HERE.projectId, newer.id));
        const front = usePromptFront.getState().request!.seq;
        await next();
        await until(() => useProject.getState().currentEndpointId === ENDPOINT && usePromptFront.getState().request?.seq !== front);
        expect(remote.requests('project.open')).toHaveLength(1);
        expect(remote.requests('chat.send')).toEqual([]);
    });

    test('a wait removed while its project opens is not revealed, and repeated presses share the switch', async () => {
        let finish: (() => void) | undefined;
        machine.answer(
            'project.open',
            ({ projectId }) =>
                new Promise((resolve) => {
                    finish = () => resolve(opened(projectId!));
                })
        );
        const opens = machine.requests('project.open').length;
        await next();
        await until(() => finish !== undefined);
        const pendingTitle = nextWaitingTitle();
        await next();
        expect(machine.requests('project.open')).toHaveLength(opens + 1);
        infos[older.id] = chatInfoOf(older.id);
        await act(async () => {
            machine.emit('chat.status', { chatId: older.id, info: infos[older.id]! });
            finish!();
        });
        await until(() => useProject.getState().current?.projectId === THERE.projectId && projectSwitch.state.kind === 'idle');
        expect(usePromptFront.getState().request).toBeNull();
        expect(page.host.querySelector(`[data-split-cell][data-view-id="${older.id}"]`) === null).toBe(true);
        expect(pendingTitle).toBeNull();
    });

    test('a failed project open reveals no prompt and keeps the normal route back', async () => {
        machine.answer('project.open', () => Promise.reject(new Error('The folder disappeared.')));
        await next();
        await until(() => projectSwitch.state.kind === 'failed');
        expect(usePromptFront.getState().request).toBeNull();
        machine.answer('project.open', ({ projectId }) => opened(projectId!));
        await act(async () => projectSwitch.back());
        await until(() => projectSwitch.state.kind === 'idle');
        expect(useProject.getState().current?.projectId).toBe(HERE.projectId);
        const opens = machine.requests('project.open').length;
        await next();
        await until(() => showing(HERE.projectId, newer.id));
        expect(machine.requests('project.open')).toHaveLength(opens);
    });

    test('a requestless terminal keeps its place between two chat waits after opening its project', async () => {
        const terminal: ProjectView = { kind: 'terminal', id: `bare-terminal-${run}`, name: 'Terminal review', node: {} };
        const middle: ProjectView = { kind: 'chat', id: `middle-chat-${run}`, name: 'Middle review', node: {} };
        const since = infos[older.id]!.requests![0]!.createdAt;
        const agent = (updatedAt: number) => ({
            kind: 'claude' as const,
            status: 'needs-you' as const,
            live: true,
            agentSessionId: 'terminal-agent',
            transcriptPath: null,
            updatedAt
        });
        infos[newer.id] = waiting(newer.id, since);
        infos[middle.id] = waiting(middle.id, since + 20_000);
        infos[older.id] = chatInfoOf(older.id);
        const here = () => response(HERE, [MAIN, newer, middle]);
        const there = () => response(THERE, [OTHER, terminal]);
        machine.answer('project.open', ({ projectId }) => (projectId === HERE.projectId ? here() : there()));
        await act(async () => {
            machine.emit('project.changed', { projectId: HERE.projectId, document: here().document });
            machine.emit('project.summary', { summary: THERE, views: projectSidebarViews([OTHER, terminal], []) });
            machine.emit('chat.status', { chatId: newer.id, info: infos[newer.id]! });
            machine.emit('chat.status', { chatId: middle.id, info: infos[middle.id]! });
            machine.emit('chat.status', { chatId: older.id, info: infos[older.id]! });
            machine.emit('session.status', { sessionId: terminal.id, agent: agent(since + 10_000) });
            machine.emit('session.status', { sessionId: terminal.id, agent: agent(since + 30_000) });
        });
        const session = {
            sessionId: terminal.id,
            cwd: '/work/borealis',
            pid: 1,
            cols: 80,
            rows: 24,
            createdAt: since,
            attached: 0,
            exited: false,
            agent: agent(since + 30_000)
        };
        machine.answer('session.list', () => ({ sessions: [session] }));
        machine.answer('session.create', () => session);
        machine.answer('session.attach', () => ({ screen: '', cols: 80, rows: 24, exited: false }));
        await next();
        await until(() => showing(HERE.projectId, newer.id));
        await next();
        await until(() => showing(THERE.projectId, terminal.id));
        await next();
        await until(() => showing(HERE.projectId, middle.id));
    });

    test('a background-only terminal retains the earlier live sighting through a reconnect', async () => {
        await page.unmount();
        const id = `reconnect-terminal-${run}`;
        const since = infos[older.id]!.requests![0]!.createdAt;
        const agent = (updatedAt: number) => ({
            kind: 'claude' as const,
            status: 'needs-you' as const,
            live: true,
            agentSessionId: 'cli',
            transcriptPath: null,
            updatedAt
        });
        const terminal: ProjectView = { kind: 'terminal', id, name: 'Reconnect review', node: {} };
        const key = endpointKey(ENDPOINT, id);
        await act(async () => {
            machine.emit('session.status', { sessionId: id, agent: agent(since) });
            machine.emit('session.status', { sessionId: id, agent: agent(since + 30_000) });
        });
        machine.answer('session.list', () => ({
            sessions: [
                { sessionId: id, cwd: '/work/borealis', pid: 1, cols: 80, rows: 24, createdAt: since, attached: 0, exited: false, agent: agent(since + 30_000) }
            ]
        }));
        machine.answer('project.sidebar', () => ({ projects: [{ summary: THERE, views: projectSidebarViews([OTHER, terminal], []) }] }));
        page = mount();
        await page.renderApp();
        await until(() => sidebarMachineSnapshot(ENDPOINT)?.state === 'ready');
        await act(async () => useSessions.getState().clear(ENDPOINT));
        expect(useWaitingSince.getState().byKey.get(key)).toBe(since);
        await act(async () => machine.drop());
        expect(useWaitingSince.getState().byKey.get(key)).toBe(since);
        await act(async () => machine.reopen());
        await until(() => sidebarMachineSnapshot(ENDPOINT)?.state === 'ready');
        expect(useWaitingSince.getState().byKey.get(key)).toBe(since);
    });
});
