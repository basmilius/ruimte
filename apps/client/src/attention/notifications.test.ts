import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { AgentRequest, AgentStatus, ChatRequestSummary } from '@ruimte/contracts';
import { startAttentionWatch, useAttention } from '@/state/attention';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { chatInfoOf } from '../../testing/chat-info';
import { notifyRequested, startAgentNotifications } from './notifications';
import { setSoundPorts } from './sounds';

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

/* A window without focus whose notifications land in `shown`; the returned function puts the globals back. */
function fakeNotifications(shown: { title: string; options: NotificationOptions }[]): () => void {
    const originals = new Map(['window', 'document', 'Notification'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    class FakeNotification {
        static permission = 'granted';
        onclick: (() => void) | null = null;
        constructor(title: string, options: NotificationOptions) {
            shown.push({ title, options });
        }
        close(): void {}
    }
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { Notification: FakeNotification, addEventListener() {}, removeEventListener() {} }
    });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { hasFocus: () => false } });
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: FakeNotification });
    return () => {
        for (const [key, descriptor] of originals) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, key);
            }
        }
    };
}

function loadBuildTerminal(): void {
    useDocument
        .getState()
        .load(
            { version: 3, rev: 1, name: 'Project', color: '#000', views: [{ kind: 'terminal', id: 'agent', name: 'Build', node: { provider: 'codex' } }] },
            null
        );
}

function setStatus(key: string, status: AgentStatus): void {
    useSessions.getState().setAgent(key, { kind: 'codex', status, live: true, agentSessionId: 'cli', transcriptPath: null, updatedAt: 1 });
}

test('completed turns only leave an unread mark; needs-you and requested alerts notify', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'agent');
    let stopAttention = () => {};
    let stopNotifications = () => {};
    try {
        loadBuildTerminal();
        stopAttention = startAttentionWatch();
        stopNotifications = startAgentNotifications();
        setStatus(key, 'running');
        setStatus(key, 'idle');
        expect(shown).toEqual([]);
        expect(useAttention.getState().unseen[key]).toBeDefined();
        setStatus(key, 'running');
        setStatus(key, 'needs-you');
        setStatus(key, 'needs-you');
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(1_000);
        expect(shown).toHaveLength(1);
        notifyRequested(endpointId, { projectId: 'project', viewId: 'agent', nodeId: 'agent', title: 'Build', body: 'The build is ready.' });
        expect(shown).toHaveLength(2);
        expect(shown[1]).toMatchObject({ title: 'Build', options: { body: 'The build is ready.', silent: true } });
    } finally {
        stopNotifications();
        stopAttention();
        useSessions.getState().forget(key);
        useAttention.getState().setUnseen(new Set());
        useDocument.getState().load(null, null);
        restore();
    }
});

test.each(['chat', 'terminal'] as const)('%s requests settle into one notification, then later requests update it quietly', async (kind) => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const key = endpointKey(currentEndpointId(), 'agent');
    const request = (id: string, command: string): ChatRequestSummary => ({
        requestId: id,
        itemId: id,
        kind: 'approval',
        createdAt: 1,
        approval: { toolName: 'Bash', subject: command, command, description: null, canAllowAlways: false }
    });

    const wait = (requests: ChatRequestSummary[]): void => {
        if (kind === 'chat') {
            useChats.getState().status(key, chatInfoOf('agent', { status: 'needs-you', requests }));

            return;
        }

        useSessions.getState().setAgent(key, {
            kind: 'codex',
            status: 'needs-you',
            requests: requests.map<AgentRequest>((request) => ({
                id: request.requestId,
                source: '',
                kind: 'approval',
                toolName: 'Bash',
                title: null,
                text: request.approval?.command ?? '',
                createdAt: 1
            })),
            live: true,
            agentSessionId: 'cli',
            transcriptPath: null,
            updatedAt: 1
        });
    };

    const events = useSettings.getState().soundEvents;
    const played: string[] = [];
    const restoreSound = setSoundPorts({ play: async (url) => void played.push(url.slice(url.lastIndexOf('/sounds/'))), now: () => 0 });
    let stopNotifications = () => {};
    try {
        useSettings.setState({ soundEvents: { ...events, question: true } });
        useDocument.getState().load({ version: 3, rev: 1, name: 'Project', color: '#000', views: [{ kind, id: 'agent', name: 'Build', node: {} }] }, null);
        stopNotifications = startAgentNotifications();
        wait([request('first', 'bun test')]);
        jest.advanceTimersByTime(400);
        wait([request('first', 'bun test')]);
        wait([request('first', 'bun test'), request('second', 'bun run check')]);
        // The sound is the one the wait began with, whatever a person changes while it settles.
        useSettings.setState({ soundEvents: { ...events, question: false } });
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(599);
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(shown).toEqual([
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+1 more)', tag: 'ruimte-agent', silent: true }) }
        ]);
        await settled();
        expect(played).toEqual(['/sounds/bar/rise.wav']);

        jest.advanceTimersByTime(10_000);
        wait([request('first', 'bun test'), request('second', 'bun run check'), request('third', 'bun run build')]);
        expect(shown).toEqual([
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+1 more)', tag: 'ruimte-agent', silent: true }) },
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+2 more)', tag: 'ruimte-agent', silent: true }) }
        ]);
        await settled();
        expect(played).toHaveLength(1);
    } finally {
        stopNotifications();
        restoreSound();
        useSettings.setState({ soundEvents: events });
        useChats.getState().forget(key);
        useSessions.getState().forget(key);
        useDocument.getState().load(null, null);
        restore();
    }
});

test('a new wait after a quick resume gets its own full settle interval', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const key = endpointKey(currentEndpointId(), 'agent');
    let stopNotifications = () => {};

    try {
        loadBuildTerminal();
        stopNotifications = startAgentNotifications();
        setStatus(key, 'needs-you');
        jest.advanceTimersByTime(400);
        setStatus(key, 'running');
        jest.advanceTimersByTime(200);
        setStatus(key, 'needs-you');
        jest.advanceTimersByTime(999);
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(shown).toHaveLength(1);
    } finally {
        stopNotifications();
        useSessions.getState().forget(key);
        useDocument.getState().load(null, null);
        restore();
    }
});

test('a snooze that runs out announces the wait again, one a person ended does not', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'agent');
    let now = 1_000_000;
    let stopNotifications = () => {};
    try {
        useSnoozes.setState({ byKey: {} });
        loadBuildTerminal();
        stopNotifications = startAgentNotifications(() => now);
        setStatus(key, 'needs-you');
        jest.advanceTimersByTime(1_000);
        expect(shown).toHaveLength(1);

        useSnoozes.getState().snooze(endpointId, 'agent', now + 60_000);
        useSnoozes.getState().unsnooze(endpointId, 'agent');
        expect(shown).toHaveLength(1);

        useSnoozes.getState().snooze(endpointId, 'agent', now + 60_000);
        now += 60_000;
        useSnoozes.getState().prune(now);
        jest.advanceTimersByTime(1_000);
        expect(shown).toHaveLength(2);
    } finally {
        stopNotifications();
        useSessions.getState().forget(key);
        useSnoozes.setState({ byKey: {} });
        useDocument.getState().load(null, null);
        restore();
    }
});

test('a wait in quiet hours raises nothing, and the end of the hours announces it', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'agent');
    // The hours are read on this computer's clock, so the window is built on the local one: 12:00 to 13:00.
    let now = new Date(2026, 10, 4, 12, 30).getTime();
    const hours = { quietHoursOn: true, quietHoursDays: [1, 2, 3, 4, 5, 6, 7], quietHoursStart: '12:00', quietHoursEnd: '13:00' };
    const before = useSettings.getState();
    let stopNotifications = () => {};
    try {
        useSettings.setState(hours);
        loadBuildTerminal();
        stopNotifications = startAgentNotifications(() => now);
        setStatus(key, 'needs-you');
        jest.advanceTimersByTime(1_000);
        expect(shown).toEqual([]);

        notifyRequested(endpointId, { projectId: 'project', viewId: 'agent', nodeId: 'agent', title: 'Build', body: 'Asked for.' });
        expect(shown).toHaveLength(1);

        now = new Date(2026, 10, 4, 13, 0).getTime();
        jest.advanceTimersByTime(30 * 60_000);
        jest.advanceTimersByTime(1_000);
        expect(shown).toHaveLength(2);
        expect(shown[1]).toMatchObject({ title: 'Build', options: { tag: 'ruimte-agent' } });
    } finally {
        stopNotifications();
        useSettings.setState({
            quietHoursOn: before.quietHoursOn,
            quietHoursDays: before.quietHoursDays,
            quietHoursStart: before.quietHoursStart,
            quietHoursEnd: before.quietHoursEnd
        });
        useSessions.getState().forget(key);
        useDocument.getState().load(null, null);
        restore();
    }
});

test('a wait that was answered during quiet hours is not announced when they end', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const key = endpointKey(currentEndpointId(), 'agent');
    let now = new Date(2026, 10, 4, 12, 30).getTime();
    const before = useSettings.getState();
    let stopNotifications = () => {};
    try {
        useSettings.setState({ quietHoursOn: true, quietHoursDays: [1, 2, 3, 4, 5, 6, 7], quietHoursStart: '12:00', quietHoursEnd: '13:00' });
        loadBuildTerminal();
        stopNotifications = startAgentNotifications(() => now);
        setStatus(key, 'needs-you');
        setStatus(key, 'running');
        now = new Date(2026, 10, 4, 13, 0).getTime();
        jest.advanceTimersByTime(30 * 60_000 + 1_000);
        expect(shown).toEqual([]);
    } finally {
        stopNotifications();
        useSettings.setState({
            quietHoursOn: before.quietHoursOn,
            quietHoursDays: before.quietHoursDays,
            quietHoursStart: before.quietHoursStart,
            quietHoursEnd: before.quietHoursEnd
        });
        useSessions.getState().forget(key);
        useDocument.getState().load(null, null);
        restore();
    }
});

test.each(['resume', 'snooze', 'remove', 'permission', 'visible', 'stop'] as const)('a pending notification is suppressed after %s', (change) => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'agent');
    let stopNotifications = () => {};

    try {
        loadBuildTerminal();
        stopNotifications = startAgentNotifications(() => 1_000);
        setStatus(key, 'needs-you');
        jest.advanceTimersByTime(400);

        switch (change) {
            case 'resume':
                setStatus(key, 'running');
                break;
            case 'snooze':
                useSnoozes.getState().snooze(endpointId, 'agent', 61_000);
                break;
            case 'remove':
                useDocument.getState().load(null, null);
                break;
            case 'permission':
                Object.defineProperty(Notification, 'permission', { value: 'denied' });
                break;
            case 'visible':
                useDocument.setState({ layout: { columns: [{ size: 1, cells: [{ viewId: 'agent', size: 1 }] }], focus: { column: 0, cell: 0 } } });
                Object.defineProperty(document, 'hasFocus', { value: () => true });
                break;
            case 'stop':
                stopNotifications();
                break;
        }

        jest.advanceTimersByTime(2_000);
        expect(shown).toEqual([]);
    } finally {
        stopNotifications();
        useSessions.getState().forget(key);
        useSnoozes.setState({ byKey: {} });
        useDocument.getState().load(null, null);
        restore();
    }
});

/* Lets a sound that was asked for reach the player: its file's address loads with the first one, then a few promises settle. */
async function settled(): Promise<void> {
    await import('./sound-urls');

    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

/* Notifications and sounds of one project with the nodes named, torn down by the returned function. */
function soundStage(views: { kind: 'chat' | 'terminal'; id: string }[]): {
    shown: { title: string; options: NotificationOptions }[];
    played: string[];
    clock: { now: number };
    stop: () => void;
} {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const played: string[] = [];
    const clock = { now: 0 };
    const restore = fakeNotifications(shown);
    const before = useSettings.getState();
    const project = useProject.getState();
    const restoreSound = setSoundPorts({ play: async (url) => void played.push(url.slice(url.lastIndexOf('/sounds/') + 8)), now: () => clock.now });

    useProject.setState({ current: { projectId: 'atlas' } as never, currentEndpointId: currentEndpointId() });
    useDocument.getState().load(
        {
            version: 3,
            rev: 1,
            name: 'Project',
            color: '#000',
            views: views.map((view) => ({ ...view, name: view.id, node: view.kind === 'terminal' ? { provider: 'codex' } : {} }))
        },
        null
    );

    const stopNotifications = startAgentNotifications(() => clock.now);

    return {
        shown,
        played,
        clock,
        stop: () => {
            stopNotifications();
            restoreSound();
            useSettings.setState({ soundPack: before.soundPack, soundEvents: before.soundEvents, projectSounds: before.projectSounds });
            useProject.setState({ current: project.current, currentEndpointId: project.currentEndpointId });

            for (const view of views) {
                useSessions.getState().forget(endpointKey(currentEndpointId(), view.id));
                useChats.getState().forget(endpointKey(currentEndpointId(), view.id));
            }

            useSnoozes.setState({ byKey: {} });
            useDocument.getState().load(null, null);
            restore();
        }
    };
}

const EVERY_EVENT = { question: true, alert: true, limit: true, error: true, finished: true };

test('a turn that stops is announced with its own line and sound, and a usage limit is never also a finished turn', async () => {
    const stage = soundStage([
        { kind: 'terminal', id: 'build' },
        { kind: 'terminal', id: 'lint' },
        { kind: 'chat', id: 'review' }
    ]);
    const key = (id: string): string => endpointKey(currentEndpointId(), id);

    try {
        useSettings.setState({ soundEvents: EVERY_EVENT });
        setStatus(key('build'), 'running');
        setStatus(key('build'), 'idle');
        setStatus(key('lint'), 'running');
        setStatus(key('lint'), 'error');
        useChats.getState().status(key('review'), chatInfoOf('review', { status: 'running' }));
        useChats.getState().status(key('review'), chatInfoOf('review', { status: 'idle', limit: { kind: 'usage' } }));

        expect(stage.shown).toEqual([
            { title: 'build', options: { body: 'Finished', tag: 'ruimte-stopped-build', silent: true } },
            { title: 'lint', options: { body: 'Stopped with an error', tag: 'ruimte-stopped-lint', silent: true } },
            { title: 'review', options: { body: 'Stopped on a usage limit', tag: 'ruimte-stopped-review', silent: true } }
        ]);
        await settled();
        expect(stage.played).toEqual(['bar/trio.wav', 'bar/knock.wav', 'bar/fall.wav']);
    } finally {
        stage.stop();
    }
});

test('a turn that stops raises nothing while its event has no sound', async () => {
    const stage = soundStage([{ kind: 'terminal', id: 'build' }]);
    const key = endpointKey(currentEndpointId(), 'build');

    try {
        useSettings.setState({ soundEvents: { ...EVERY_EVENT, finished: false } });
        setStatus(key, 'running');
        setStatus(key, 'idle');
        expect(stage.shown).toEqual([]);
        await settled();
        expect(stage.played).toEqual([]);
    } finally {
        stage.stop();
    }
});

test('a project sounds in its own pack, and a silent project raises nothing for a turn that stops', async () => {
    const stage = soundStage([{ kind: 'terminal', id: 'build' }]);
    const key = endpointKey(currentEndpointId(), 'build');
    const project = endpointKey(currentEndpointId(), 'atlas');

    try {
        useSettings.setState({ soundEvents: EVERY_EVENT, projectSounds: { [project]: { pack: 'glass' } } });
        setStatus(key, 'running');
        setStatus(key, 'idle');
        await settled();
        expect(stage.played).toEqual(['glass/trio.wav']);

        useSettings.setState({ projectSounds: { [project]: { silent: true, pack: 'glass' } } });
        stage.clock.now = 5_000;
        setStatus(key, 'running');
        setStatus(key, 'idle');
        expect(stage.shown).toHaveLength(1);
        await settled();
        expect(stage.played).toHaveLength(1);
    } finally {
        stage.stop();
    }
});

test('two turns that finish within a second sound once, and each still gets its notification', async () => {
    const stage = soundStage([
        { kind: 'terminal', id: 'build' },
        { kind: 'terminal', id: 'lint' }
    ]);
    const key = (id: string): string => endpointKey(currentEndpointId(), id);

    try {
        useSettings.setState({ soundEvents: EVERY_EVENT });
        setStatus(key('build'), 'running');
        setStatus(key('lint'), 'running');
        setStatus(key('build'), 'idle');
        stage.clock.now = 400;
        setStatus(key('lint'), 'idle');
        expect(stage.shown).toHaveLength(2);
        await settled();
        expect(stage.played).toEqual(['bar/trio.wav']);
    } finally {
        stage.stop();
    }
});

test.each(['in sight', 'snoozed', 'quiet hours'] as const)('a turn that stops plays nothing for a node %s', async (why) => {
    const stage = soundStage([{ kind: 'terminal', id: 'build' }]);
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'build');
    const before = useSettings.getState();

    try {
        useSettings.setState({ soundEvents: EVERY_EVENT });
        setStatus(key, 'running');

        switch (why) {
            case 'in sight':
                useDocument.setState({ layout: { columns: [{ size: 1, cells: [{ viewId: 'build', size: 1 }] }], focus: { column: 0, cell: 0 } } });
                Object.defineProperty(document, 'hasFocus', { value: () => true });
                break;
            case 'snoozed':
                useSnoozes.getState().snooze(endpointId, 'build', 61_000);
                break;
            case 'quiet hours':
                // The hours are read on this computer's clock, so the window is built on the local one.
                stage.clock.now = new Date(2026, 10, 4, 12, 30).getTime();
                useSettings.setState({ quietHoursOn: true, quietHoursDays: [1, 2, 3, 4, 5, 6, 7], quietHoursStart: '12:00', quietHoursEnd: '13:00' });
                break;
        }

        setStatus(key, 'idle');
        expect(stage.shown).toEqual([]);
        await settled();
        expect(stage.played).toEqual([]);
    } finally {
        useSettings.setState({
            quietHoursOn: before.quietHoursOn,
            quietHoursDays: before.quietHoursDays,
            quietHoursStart: before.quietHoursStart,
            quietHoursEnd: before.quietHoursEnd
        });
        stage.stop();
    }
});

test('an alert someone asked for sounds in the pack of its own project', async () => {
    const stage = soundStage([{ kind: 'terminal', id: 'build' }]);
    const endpointId = currentEndpointId();
    const claimed: string[] = [];
    const restoreSound = setSoundPorts({
        play: async (url) => void stage.played.push(url.slice(url.lastIndexOf('/sounds/') + 8)),
        now: () => 0,
        claim: async (tag) => claimed.push(tag) === 1
    });

    try {
        useSettings.setState({ soundEvents: EVERY_EVENT, projectSounds: { [endpointKey(endpointId, 'other')]: { pack: 'grand' } } });
        notifyRequested(endpointId, { projectId: 'other', viewId: 'view', nodeId: 'node', title: 'Deploy', body: 'It is live.' });
        await settled();
        expect(stage.played).toEqual(['grand/chime.wav']);
        expect(claimed).toEqual([`ruimte-requested-${endpointId}-node`]);
    } finally {
        restoreSound();
        stage.stop();
    }
});
