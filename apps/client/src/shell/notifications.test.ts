import { expect, test } from 'bun:test';
import type { AgentRequest, AgentStatus } from '@ruimte/contracts';
import { startAttentionWatch, useAttention } from '@/state/attention';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { notifyRequested, startAgentNotifications } from './notifications';

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

test('a wait says what it asks, and a request that joins it updates the notification without a sound', () => {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const restore = fakeNotifications(shown);
    const key = endpointKey(currentEndpointId(), 'agent');
    const request = (id: string, text: string): AgentRequest => ({ id, source: '', kind: 'approval', toolName: 'Bash', title: null, text, createdAt: 1 });
    const wait = (requests: AgentRequest[]): void => {
        useSessions.getState().setAgent(key, {
            kind: 'codex',
            status: 'needs-you',
            requests,
            live: true,
            agentSessionId: 'cli',
            transcriptPath: null,
            updatedAt: 1
        });
    };

    const sound = useSettings.getState().agentsTurnSound;
    let stopNotifications = () => {};
    try {
        useSettings.setState({ agentsTurnSound: true });
        loadBuildTerminal();
        stopNotifications = startAgentNotifications();
        wait([request('first', 'bun test')]);
        wait([request('first', 'bun test')]);
        wait([request('first', 'bun test'), request('second', 'bun run check')]);
        expect(shown).toEqual([
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test', tag: 'ruimte-agent', silent: false }) },
            { title: 'Build', options: expect.objectContaining({ body: 'Wants to run: bun test (+1 more)', tag: 'ruimte-agent', silent: true }) }
        ]);
    } finally {
        stopNotifications();
        useSettings.setState({ agentsTurnSound: sound });
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
        expect(shown).toHaveLength(1);

        useSnoozes.getState().snooze(endpointId, 'agent', now + 60_000);
        useSnoozes.getState().unsnooze(endpointId, 'agent');
        expect(shown).toHaveLength(1);

        useSnoozes.getState().snooze(endpointId, 'agent', now + 60_000);
        now += 60_000;
        useSnoozes.getState().prune(now);
        expect(shown).toHaveLength(2);
    } finally {
        stopNotifications();
        useSessions.getState().forget(key);
        useSnoozes.setState({ byKey: {} });
        useDocument.getState().load(null, null);
        restore();
    }
});
