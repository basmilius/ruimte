import {
    agents,
    chats,
    defineAgentTool,
    defineLaunchSource,
    defineMachineSource,
    defineProblemSource,
    defineServer,
    defineTerminalProfile,
    emit,
    files,
    log,
    machine,
    onEvent,
    problems,
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

const LAUNCHES = 'probe-launches';
const PROBLEMS = 'probe-problems';
// What the launch source lists comes from here, so a scenario changes it and has the source say so.
let revision = 1;
let launchesChanged: (() => void) | null = null;
let launchSourceRefused: string | null = null;
let problemSourceRefused: string | null = null;

try {
    defineLaunchSource({
        id: LAUNCHES,
        title: 'Probe launches',
        list: () => [
            { id: 'serve', name: 'Serve', kind: 'service', spawn: { command: 'sh', args: ['-c', 'serve'] }, fingerprint: `revision-${revision}`, port: 4000 },
            // No launch, so the machine leaves it out and says why.
            { id: 'Not An Id', name: 'Broken', kind: 'task', spawn: { command: 'true' }, fingerprint: 'none' }
        ],
        watch: (_project, changed) => {
            launchesChanged = changed;

            return () => {
                launchesChanged = null;
            };
        }
    });
} catch (e) {
    launchSourceRefused = (e as Error).message;
}

try {
    defineProblemSource({ id: PROBLEMS, title: 'Probe problems' });
} catch (e) {
    problemSourceRefused = (e as Error).message;
}

const MACHINES = 'probe-machines';
let machineSourceRefused: string | null = null;

try {
    defineMachineSource({
        id: MACHINES,
        title: 'Probe machines',
        list: () => [
            { id: 'box', title: 'Box', place: 'A box on this computer', running: false },
            { id: 'slow', title: 'Slow', place: 'A box that takes its time', running: false },
            { id: 'broken', title: 'Broken', place: 'A box with nothing to run', running: true },
            // No place, so the machine leaves it out and says why.
            { id: 'Not An Id', title: 'Unnamed', place: '', running: false }
        ],
        async start(candidate, { report, signal }) {
            report(`Describing ${candidate.id}`);

            if (candidate.id === 'slow') {
                // Answers only once the person stopped the start.
                await new Promise((_resolve, reject) => {
                    const stopped = (): void => reject(new Error('Stopped by the person'));

                    if (signal.aborted) {
                        stopped();
                    } else {
                        signal.addEventListener('abort', stopped);
                    }
                });
            }

            return {
                steps: candidate.id === 'broken' ? [] : [{ title: 'Start the box', spawn: { command: 'sh', args: ['-c', 'box up'] } }],
                login: { command: 'sh', args: ['-c', 'box login'] },
                fingerprint: 'revision-1'
            };
        }
    });
} catch (e) {
    machineSourceRefused = (e as Error).message;
}

// What it heard of the machine, in the shape it was handed. The second listener follows another project only.
const heardOfMachine: object[] = [];
const heardElsewhere: object[] = [];

onEvent('launch.status', (event) => void heardOfMachine.push({ 'launch.status': event }));
onEvent('project.opened', (event) => void heardOfMachine.push({ 'project.opened': event }));
onEvent('project.closed', (event) => void heardOfMachine.push({ 'project.closed': event }));
onEvent('launch.status', (event) => void heardElsewhere.push(event), { project: { id: 'another-project' } });

// What each watch of a file heard, by the path it follows, and how to stop it.
const fileChanges = new Map<string, number>();
const fileWatches = new Map<string, () => void>();

const providerApi = defineServer({
    async sourcesRefused() {
        return { launches: launchSourceRefused, problems: problemSourceRefused };
    },
    async machineSourceRefused() {
        return machineSourceRefused;
    },
    /* Changes what the launch source lists, and says so if the machine asked it to. */
    async bump() {
        revision += 1;
        launchesChanged?.();
    },
    async machineHeard() {
        return { heard: heardOfMachine, elsewhere: heardElsewhere };
    },
    async reports(projectId: string, source: string, reported: { path: string; problems: object[] }[]) {
        const answer = await problems.report({ id: projectId }, source, reported as never);

        return answer.ok ? { ok: true, keys: Object.keys(answer), value: String(answer.value) } : answer;
    },
    async clears(projectId: string, source: string) {
        return problems.clear({ id: projectId }, source);
    },
    async readsFile(projectId: string, path: string) {
        return files.readText({ id: projectId }, path);
    },
    async listsFolder(projectId: string, folder: string) {
        const listed = await files.list({ id: projectId }, folder);

        return listed.ok ? listed.value.map((entry) => `${entry.kind} ${entry.name}`) : listed;
    },
    async watchesFile(projectId: string, path: string) {
        const watching = await files.watch({ id: projectId }, path, () => fileChanges.set(path, (fileChanges.get(path) ?? 0) + 1));

        if (!watching.ok) {
            return watching;
        }

        fileWatches.set(path, watching.value);

        return null;
    },
    async unwatchesFile(path: string) {
        fileWatches.get(path)?.();
    },
    async fileChanges(path: string) {
        return fileChanges.get(path) ?? 0;
    }
});

const contract = defineServer({ ...api, ...terminalApi, ...providerApi });

export type ContractServer = typeof contract;
export default contract;
