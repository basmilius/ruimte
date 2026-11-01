/// <reference types="bun" />
import { defineNodeContext, defineServer, emit, log, onEvent, secrets, storage } from '@ruimte/extension/server';

let eventsSeen = 0;

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
