/// <reference types="bun" />
import { agents, chats, defineAgentTool, defineNodeContext, defineServer, emit, log, onEvent, schedule, secrets, storage } from '@ruimte/extension/server';

let eventsSeen = 0;
let ticks = 0;

defineAgentTool<{ about?: string }>({
    id: 'fact',
    description: 'Answers a fact, to show an agent can call an extension',
    parameters: { type: 'object', properties: { about: { type: 'string' } } },
    run: ({ about }, { caller }) => `${about ?? 'Everything'} is 42, for ${caller}`
});

schedule({
    id: 'tick',
    every: '10s',
    run: () => {
        ticks += 1;
        emit('tick', { ticks });
    }
});

onEvent('chat.status', ({ chat }) => {
    eventsSeen += 1;
    log.info(`${chat.id} is ${chat.status}`);
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
    async startChat(projectId: string) {
        return agents.start({ project: { id: projectId }, title: 'From poc-server', prompt: 'Say hello from poc-server.' });
    },
    async chatCount() {
        const listed = await chats.list();

        return listed.ok ? listed.value.length : listed.error.code;
    },
    async poke(chatId: string) {
        return chats.send(chatId, 'Say hello from poc-server.');
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
