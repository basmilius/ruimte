/// <reference types="bun" />
import { agents, chats, defineNodeContext, defineServer, emit, log, onEvent, schedule, secrets, storage } from '@ruimte/extension/server';

let eventsSeen = 0;
let ticks = 0;

schedule({
    id: 'tick',
    every: '10s',
    run: () => {
        ticks += 1;
        emit('tick', { ticks });
    }
});

onEvent('chat.status', () => {
    eventsSeen += 1;
});
defineNodeContext<{ fact: string }>('fact', (node) => [{ text: node.data.fact }]);

const api = defineServer({
    async ping() {
        return 'pong';
    },
    async count() {
        const next = ((await storage.get<number>('count')) ?? 0) + 1;

        await storage.set('count', next);
        log.info(`Counted to ${next}`);

        return next;
    },
    async remember(value: string) {
        await secrets.set('value', value);

        return (await secrets.get('value')) === value;
    },
    async tick() {
        emit('tick', { at: 'server' });

        return 'emitted';
    },
    async ticks() {
        return ticks;
    },
    async ask(prompt: string) {
        return agents.run({ prompt });
    },
    async chatCount() {
        return (await chats.list()).length;
    },
    async poke(chatId: string) {
        await chats.send(chatId, 'Say hello from poc-server.');

        return 'sent';
    },
    async eventsSeen() {
        return eventsSeen;
    },
    async fail() {
        throw new Error('On purpose');
    },
    async crash() {
        process.exit(1);
    }
});

export type PocServer = typeof api;
export default api;
