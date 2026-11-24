import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import { serverContract } from '../contract/server';
import type { ContractServer } from '../server';

const PERSON_TERMINAL = 'shell-1';

serverContract(async (permissions, { provenance, ...manifest } = {}) => {
    const server = await createTestServer<ContractServer>({
        manifest: { permissions, ...manifest },
        ...(provenance === undefined ? {} : { provenance }),
        project: { id: 'project-a' },
        terminals: [{ id: PERSON_TERMINAL }],
        answers: {
            'agents.start': () => ({ id: 'chat-1' }),
            'chats.send': () => undefined,
            'agents.run': ({ prompt }) => ({ text: `Answer to ${prompt}` }),
            'chats.list': () => [{ id: 'chat-1', provider: 'claude', status: 'idle', model: null, cwd: '/work' }],
            'terminals.read': () => 'The screen',
            'machine.run': { 'launch.start': ({ launch }) => ({ id: launch, name: launch }) }
        }
    });
    const terminal = (id: string) => server.terminals.find((candidate) => candidate.id === id);

    return {
        project: 'project-a',
        call: (method, ...args) => server.call(method as never, ...(args as [never])),
        fire: (name, payload) => server.fire(name as 'chat.event', payload as { chatId: string }),
        tool: (id, input, caller) => server.tool(id).run(input, { caller }),
        logs: async () => server.logs,
        emitted: async () => server.emitted,
        personTerminal: PERSON_TERMINAL,
        typed: async (id) => terminal(id)?.written.join('') ?? '',
        variable: async (id, name) => terminal(id)?.spawn?.env?.[name],
        waits: async (id) => {
            const waiting = terminal(id);

            if (waiting !== undefined) {
                waiting.needsYou = true;
            }
        },
        launches: async (source) => ({ title: server.launchSource(source).title, launches: await server.launchSource(source).list() }),
        launchChanges: async (source) => server.launchSource(source).changes,
        unfollowLaunches: (source) => server.launchSource(source).stop(),
        machines: async (source) => ({ title: server.machineSource(source).title, candidates: await server.machineSource(source).list() }),
        machineStart: async (source, candidate, stopped) => {
            const stop = new AbortController();

            if (stopped) {
                stop.abort();
            }

            try {
                return { ...(await server.machineSource(source).start(candidate, { signal: stop.signal })), failure: null };
            } catch (e) {
                return { start: null, reports: [], failure: (e as Error).message };
            }
        },
        uiSource: async (id) => {
            const { read: _read, ...told } = server.uiSource(id);

            return told;
        },
        readUi: async (id, args) => {
            try {
                return { value: await server.uiSource(id).read(args) };
            } catch (e) {
                return { failure: (e as Error).message };
            }
        },
        notify: async (channel, body, reason) => ({
            title: server.notificationChannel(channel).title,
            delivered: await server.notificationChannel(channel).deliver({ body, reason })
        }),
        launchIs: (launch, state, exitCode) => server.fire('launch.status', { project: { id: 'project-a' }, launch, state, exitCode }),
        projectIs: (open) => {
            if (open) {
                server.fire('project.opened', { project: { id: 'project-a', name: 'Project', folder: '/project' } });
            } else {
                server.fire('project.closed', { project: { id: 'project-a' } });
            }
        },
        problems: async () =>
            server.problems.flatMap(({ source, files }) =>
                files.map((file) => ({ source, path: file.path, messages: file.problems.map((problem) => problem.message) }))
            ),
        writeFile: async (path, text) => server.writeFile(path, text)
    };
});

describe('a test server', () => {
    test('loads the files of server/ afresh, so one keeps nothing another heard', async () => {
        const first = await createTestServer<ContractServer>();

        first.fire('chat.event', { chatId: 'chat-1' });

        expect(await first.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
        expect(await (await createTestServer<ContractServer>()).call('heard')).toEqual({ ok: true, value: [] });
    });
});
