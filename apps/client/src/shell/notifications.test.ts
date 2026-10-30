import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { AgentStatus, ChatRequestSummary } from '@ruimte/contracts';
import { chatInfoOf } from '../../testing/chat-info';
import { startAttentionWatch, useAttention } from '@/state/attention';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { notifyRequested, startAgentNotifications } from './notifications';

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

test('concurrent requests settle into one notification, then later requests update it quietly', () => {
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
        useChats.getState().status(key, chatInfoOf('agent', { status: 'needs-you', requests }));
    };

    const sound = useSettings.getState().agentsTurnSound;
    let stopNotifications = () => {};
    try {
        useSettings.setState({ agentsTurnSound: true });
        useDocument
            .getState()
            .load({ version: 3, rev: 1, name: 'Project', color: '#000', views: [{ kind: 'chat', id: 'agent', name: 'Build', node: {} }] }, null);
        stopNotifications = startAgentNotifications();
        wait([request('first', 'bun test')]);
        jest.advanceTimersByTime(400);
        wait([request('first', 'bun test')]);
        wait([request('first', 'bun test'), request('second', 'bun run check')]);
        useSettings.setState({ agentsTurnSound: false });
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(599);
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(shown).toEqual([
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+1 more)', tag: 'ruimte-agent', silent: false }) }
        ]);

        jest.advanceTimersByTime(10_000);
        wait([request('first', 'bun test'), request('second', 'bun run check'), request('third', 'bun run build')]);
        expect(shown).toEqual([
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+1 more)', tag: 'ruimte-agent', silent: false }) },
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+2 more)', tag: 'ruimte-agent', silent: true }) }
        ]);
    } finally {
        stopNotifications();
        useSettings.setState({ agentsTurnSound: sound });
        useChats.getState().forget(key);
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
