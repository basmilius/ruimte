import { defineServer, onEvent, storage } from '@ruimte/extension/server';
import { HISTORY } from './service';

/* The keys the client reads as `machine` storage, so a count shows without a call. */
export const CHAT_TURNS = 'chatTurns';
export const TERMINAL_TURNS = 'terminalTurns';

// What runs now, so a status that is said twice counts once.
const running = new Set<string>();
// One write at a time: two events in a row would otherwise both read the same count.
let counted: Promise<void> = Promise.resolve();

function count(key: string, id: string, isRunning: boolean): void {
    if (!isRunning) {
        running.delete(id);

        return;
    }

    if (running.has(id)) {
        return;
    }

    running.add(id);
    counted = counted.then(async () => storage.set(key, ((await storage.get<number>(key)) ?? 0) + 1));
}

onEvent('chat.status', ({ chat }) => count(CHAT_TURNS, chat.id, chat.status === 'running'));
onEvent('session.status', ({ nodeId, status }) => count(TERMINAL_TURNS, nodeId, status === 'running'));

const api = defineServer({
    async history() {
        return HISTORY;
    },
    /* The turns this machine saw start, once every count so far is written. */
    async counts() {
        await counted;

        return { chats: (await storage.get<number>(CHAT_TURNS)) ?? 0, terminals: (await storage.get<number>(TERMINAL_TURNS)) ?? 0 };
    }
});

export type PulseboardServer = typeof api;
export default api;
