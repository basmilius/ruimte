import { describe, expect, test } from 'bun:test';
import type { ComputerApproval } from '@ruimte/contracts';
import { until } from './computer-test-helpers.ts';
import { presenceWords } from './overlay-words.ts';
import { ComputerPresence, type PresenceShow } from './presence.ts';

const card = (nodeId: string, app: string): ComputerApproval => ({
    requestId: `request-${nodeId}`,
    nodeId,
    surface: 'chat',
    nodeTitle: null,
    projectId: null,
    projectName: null,
    app: { name: app, bundleId: `com.example.${app.toLowerCase()}` },
    command: 'state',
    createdAt: 1,
    expiresAt: 2
});

interface Setup {
    presence: ComputerPresence;
    shown: string[];
    logs: string[];
    alive: Set<string>;
    holders: (string | null)[];
    // Makes every send wait until the test lets it go.
    gate: { held: boolean; release: () => void };
}

const setup = (options: { language?: string; fail?: boolean } = {}): Setup => {
    const shown: string[] = [];
    const logs: string[] = [];
    const holders: (string | null)[] = [];
    const alive = new Set(['chat-1', 'chat-2', 'term-1']);
    let waiting: (() => void)[] = [];
    const gate = {
        held: false,
        release: () => {
            gate.held = false;
            const due = waiting;
            waiting = [];
            for (const run of due) {
                run();
            }
        }
    };
    const presence = new ComputerPresence({
        send: async (show: PresenceShow) => {
            if (gate.held) {
                await new Promise<void>((resume) => waiting.push(resume));
            }
            shown.push(show.label === undefined ? show.state : `${show.state}: ${show.label}`);
            if (options.fail) {
                throw new Error('the helper went away');
            }
        },
        words: () => presenceWords(options.language),
        alive: (nodeId) => alive.has(nodeId),
        onHolder: (nodeId) => holders.push(nodeId),
        log: (message) => logs.push(message)
    });
    return { presence, shown, logs, alive, holders, gate };
};

/* Lets the sends that are out land; a send never waits on a clock. */
const settled = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

describe('the presence of the agent that holds the session', () => {
    test('works between actions, waits on the person and is done when the turn ends', async () => {
        const { presence, shown, holders } = setup();
        presence.status('chat-1', 'running');
        presence.calling('chat-1');
        presence.acting('chat-1');
        await settled();
        // The helper shows the action itself.
        expect(shown).toEqual([]);
        presence.acted('chat-1');
        await until(() => shown.length === 1);
        presence.status('chat-1', 'needs-you');
        await until(() => shown.length === 2);
        presence.status('chat-1', 'running');
        await until(() => shown.length === 3);
        presence.status('chat-1', 'running');
        presence.status('chat-1', 'idle');
        await until(() => shown.length === 4);
        expect(shown).toEqual(['think', 'waiting', 'think', 'done']);
        expect(holders).toEqual(['chat-1', null]);
        // Done ends the hold: the next turn of the same chat shows nothing until it acts again.
        presence.status('chat-1', 'running');
        await settled();
        expect(shown).toHaveLength(4);
    });

    test('is driven only by the agent whose call reached the helper last', async () => {
        const { presence, shown } = setup();
        presence.calling('chat-1');
        presence.acting('chat-1');
        presence.acted('chat-1');
        await until(() => shown.length === 1);
        presence.status('term-1', 'needs-you');
        presence.status('chat-2', 'idle');
        await settled();
        expect(shown).toEqual(['think']);
        presence.calling('term-1');
        presence.acting('term-1');
        expect(presence.holder).toBe('term-1');
        presence.status('chat-1', 'idle');
        presence.acted('term-1');
        await until(() => shown.length === 2);
        // term-1 said it needs the person before it held the session; that is what it shows now.
        expect(shown.at(-1)).toBe('waiting');
        presence.status('term-1', 'exited');
        await until(() => shown.length === 3);
        expect(shown.at(-1)).toBe('idle');
    });

    test('asks for permission with the app while a card of the holder stands, and a card claims a session nobody holds', async () => {
        const { presence, shown } = setup();
        presence.approvals([card('chat-1', 'TextEdit')]);
        await until(() => shown.length === 1);
        expect(shown).toEqual(['permission: Waiting for permission for TextEdit']);
        expect(presence.holder).toBe('chat-1');
        // Somebody else's card does not take the session over.
        presence.approvals([card('chat-1', 'TextEdit'), card('chat-2', 'Notes')]);
        presence.approvals([card('chat-2', 'Notes')]);
        await until(() => shown.length === 2);
        expect(shown.at(-1)).toBe('think');
        expect(presence.holder).toBe('chat-1');
    });

    test('shows an error after a failed action until the agent moves on', async () => {
        const { presence, shown } = setup({ language: 'nl' });
        presence.status('chat-1', 'running');
        presence.calling('chat-1');
        presence.acting('chat-1');
        presence.failed('chat-1', 'TextEdit');
        presence.acted('chat-1');
        await until(() => shown.length === 1);
        expect(shown).toEqual(['error: Er ging iets mis in TextEdit']);
        presence.status('chat-1', 'running');
        await settled();
        expect(shown).toHaveLength(1);
        presence.calling('chat-1');
        presence.acting('chat-1');
        presence.acted('chat-1');
        await until(() => shown.length === 2);
        expect(shown.at(-1)).toBe('think');
    });

    test('is idle when the turn is interrupted, the node closes or it goes without a word', async () => {
        const { presence, shown, alive } = setup();
        const hold = async (nodeId: string): Promise<void> => {
            presence.calling(nodeId);
            presence.acting(nodeId);
            presence.acted(nodeId);
            await until(() => shown.at(-1) === 'think');
        };
        await hold('chat-1');
        presence.turnEnded('chat-1', true);
        await until(() => shown.at(-1) === 'idle');
        await hold('chat-2');
        presence.turnEnded('chat-2', false);
        await until(() => shown.at(-1) === 'done');
        await hold('term-1');
        presence.closed('term-1');
        await until(() => shown.at(-1) === 'idle');
        await hold('chat-1');
        alive.delete('chat-1');
        presence.status('chat-1', 'running');
        await until(() => shown.at(-1) === 'idle');
        expect(presence.holder).toBeNull();
    });

    test('sends only the newest state while one is out, in order', async () => {
        const { presence, shown, gate } = setup();
        presence.calling('chat-1');
        presence.acting('chat-1');
        gate.held = true;
        presence.acted('chat-1');
        await settled();
        presence.status('chat-1', 'needs-you');
        presence.status('chat-1', 'running');
        presence.status('chat-1', 'needs-you');
        gate.release();
        await until(() => shown.length === 2);
        await settled();
        expect(shown).toEqual(['think', 'waiting']);
    });

    test('logs a send that failed and carries on', async () => {
        const { presence, shown, logs } = setup({ fail: true });
        presence.calling('chat-1');
        presence.acting('chat-1');
        presence.acted('chat-1');
        await until(() => logs.length === 1);
        expect(logs[0]).toBe('Showing think at the computer use cursor failed: the helper went away');
        presence.status('chat-1', 'needs-you');
        await until(() => shown.length === 2);
    });

    test('says nothing more once the session was dropped', async () => {
        const { presence, shown } = setup();
        presence.calling('chat-1');
        presence.acting('chat-1');
        presence.drop();
        presence.acted('chat-1');
        presence.status('chat-1', 'idle');
        await settled();
        expect(shown).toEqual([]);
    });
});
