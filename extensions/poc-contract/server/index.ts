import { chats, defineAgentTool, defineServer, emit, machine, onEvent, storage } from '@ruimte/extension/server';
import { hear, heard } from './heard';

// As the module loads, as an extension that sets itself up from what it kept does.
const loads = ((await storage.get<number>('loads')) ?? 0) + 1;

await storage.set('loads', loads);

onEvent('chat.event', ({ chatId }) => hear(chatId));

defineAgentTool<{ text: string }>({
    id: 'echo',
    description: 'Says the text back',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    run: ({ text }, { caller }) => `${text}, for ${caller}`
});

const api = defineServer({
    async heard() {
        return heard();
    },
    async loads() {
        return [loads, await storage.get<number>('loads')];
    },
    async finish() {
        emit('done', undefined);
        emit('counted', { count: loads });
    },
    async keep(key: string, value: number) {
        await storage.set(key, value);
    },
    async kept(key: string) {
        return (await storage.get<number>(key)) ?? null;
    },
    // The keys go back too: a Result crosses as JSON, which drops a key set to undefined.
    async send(chatId: string) {
        const sent = await chats.send(chatId, 'Hello');

        return sent.ok ? { ok: true, keys: Object.keys(sent), value: String(sent.value) } : sent;
    },
    async start(input: object) {
        try {
            return await machine.run({ id: 'project-a' }, 'launch.start', input as { launch: string });
        } catch (e) {
            return `${(e as Error).name}: ${(e as Error).message}`;
        }
    }
});

export type ContractServer = typeof api;
export default api;
