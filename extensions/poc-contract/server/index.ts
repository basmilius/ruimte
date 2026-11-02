import { chats, defineAgentTool, defineServer, machine, onEvent } from '@ruimte/extension/server';
import { hear, heard } from './heard';

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
