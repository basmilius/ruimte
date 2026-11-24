import {
    agents,
    chats,
    defineAgentTool,
    defineServer,
    defineTerminalProfile,
    emit,
    log,
    machine,
    onEvent,
    secrets,
    storage,
    terminals
} from '@ruimte/extension/server';
import { hear, heard } from './heard';

const SHELL = 'probe-shell';

// As the module loads, as an extension that sets itself up from what it kept does.
const loads = ((await storage.get<number>('loads')) ?? 0) + 1;

await storage.set('loads', loads);

const stopHearing = onEvent('chat.event', ({ chatId }) => hear(chatId));

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
    async deaf() {
        stopHearing();
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
    async forget(key: string) {
        await storage.delete(key);
    },
    // What an extension prints is its own, also a line that reads as JSON.
    async prints() {
        console.debug('null');
        console.dir(42);

        return 'printed';
    },
    // The keys go back too: a Result crosses as JSON, which drops a key set to undefined.
    async send(chatId: string) {
        const sent = await chats.send(chatId, 'Hello');

        return sent.ok ? { ok: true, keys: Object.keys(sent), value: String(sent.value) } : sent;
    },
    async asks(prompt: string) {
        return agents.run({ prompt });
    },
    async chatIds() {
        const listed = await chats.list();

        return listed.ok ? listed.value.map((chat) => chat.id) : listed;
    },
    // Beside what storage holds under the same key, which a secret never reaches.
    async hide(value: string) {
        await secrets.set('token', value);
        log.info('Kept a secret');

        return [(await secrets.get('token')) ?? null, (await storage.get<string>('token')) ?? null];
    },
    async startsChat(projectId: string) {
        return agents.start({ project: { id: projectId }, prompt: 'Hello', title: 'Helper' });
    },
    async start(input: object) {
        try {
            return await machine.run({ id: 'project-a' }, 'launch.start', input as { launch: string });
        } catch (e) {
            return `${(e as Error).name}: ${(e as Error).message}`;
        }
    }
});

// A provider registers as the module loads, where a refusal throws: kept, so a scenario reads why.
let profileRefused: string | null = null;

try {
    defineTerminalProfile({
        id: SHELL,
        title: 'Probe shell',
        spawn: ({ project }) => ({ command: 'sh', env: { PROBE_PROJECT: project.id } })
    });
} catch (e) {
    profileRefused = (e as Error).message;
}

const terminalApi = defineServer({
    async profileRefused() {
        return profileRefused;
    },
    async opensShell(projectId: string) {
        return terminals.open({ project: { id: projectId }, profile: SHELL, title: 'Probe' });
    },
    async opensPlain(projectId: string) {
        return terminals.open({ project: { id: projectId } });
    },
    async types(terminalId: string, text: string) {
        const typed = await terminals.write({ id: terminalId }, text);

        return typed.ok ? { ok: true, keys: Object.keys(typed), value: String(typed.value) } : typed;
    },
    async reads(terminalId: string) {
        return terminals.read({ id: terminalId });
    }
});

const contract = defineServer({ ...api, ...terminalApi });

export type ContractServer = typeof contract;
export default contract;
