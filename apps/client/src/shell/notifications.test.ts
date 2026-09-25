import { expect, test } from 'bun:test';
import type { AgentStatus } from '@ruimte/contracts';
import { startAttentionWatch, useAttention } from '@/state/attention';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { notifyRequested, startAgentNotifications } from './notifications';

test('completed turns only leave an unread mark; needs-you and requested alerts notify', () => {
    const originals = new Map(['window', 'document', 'Notification'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const shown: { title: string; options: NotificationOptions }[] = [];
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
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, 'agent');
    let stopAttention = () => {};
    let stopNotifications = () => {};
    try {
        useDocument
            .getState()
            .load(
                { version: 3, rev: 1, name: 'Project', color: '#000', views: [{ kind: 'terminal', id: 'agent', name: 'Build', node: { provider: 'codex' } }] },
                null
            );
        stopAttention = startAttentionWatch();
        stopNotifications = startAgentNotifications();
        const status = (status: AgentStatus) =>
            useSessions.getState().setAgent(key, { kind: 'codex', status, live: true, agentSessionId: 'cli', transcriptPath: null, updatedAt: 1 });
        status('running');
        status('idle');
        expect(shown).toEqual([]);
        expect(useAttention.getState().unseen[key]).toBeDefined();
        status('running');
        status('needs-you');
        status('needs-you');
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
        for (const [key, descriptor] of originals) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, key);
            }
        }
    }
});
