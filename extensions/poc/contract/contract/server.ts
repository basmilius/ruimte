/*
 * What `server/` of an extension does, held the same way against `createTestServer` (`test/server.test.ts`) and the
 * `ExtensionHost` of the machine with a real process (`apps/server/src/extensions/contract.integration.test.ts`).
 * Each world runs `poc.contract`'s own `server/` with the permissions a scenario asks for, answers `chats.send`,
 * answers `agents.run` with `Answer to <prompt>`, lists the one chat `chat-1`, answers `launch.start` with the launch
 * it was given, and starts a chat in `project`, which the machine's world does with its own chat start and action
 * registry.
 */
import { describe, expect, test } from 'bun:test';
import type * as Server from '../../../../packages/extension/server';

export const ID = 'poc.contract';

export interface ServerWorld {
    project: string;
    /* A method of `server/`, answered as the client reads it. */
    call(method: string, ...args: unknown[]): Promise<Server.Result<unknown>>;
    /* A machine event, as the machine hands it on. */
    fire(name: string, payload: object): void;
    tool(id: string, input: object, caller: string): Promise<string>;
    logs(): Promise<string[]>;
    /* What `emit` said, as a client hears it. */
    emitted(): Promise<{ name: string; payload?: unknown }[]>;
    /* A terminal a person opened, which shows `The screen`. */
    personTerminal: string;
    /* What was typed into a terminal, in order. */
    typed(terminal: string): Promise<string>;
    /* A variable the program of a terminal started with. */
    variable(terminal: string, name: string): Promise<string | undefined>;
    /* An agent in this terminal asks the person something, as its hook reports it. */
    waits(terminal: string): Promise<void>;
    /* What a launch source lists in `project`, read as the machine reads it, which also has the source tell of changes. */
    launches(source: string): Promise<{ title: string; launches: Server.LaunchDescription[] }>;
    /* How often a launch source said its list changed. */
    launchChanges(source: string): Promise<number>;
    /* Has a launch source stop telling of changes, as when the project closes. */
    unfollowLaunches(source: string): Promise<void>;
    /* What a machine source lists in `project`, read as the machine reads it. Rejects for a source the extension does not supply. */
    machines(source: string): Promise<{ title: string; candidates: Server.MachineCandidate[] }>;
    /*
     * Asks a machine source what starts a machine in one of its places, as the machine does before it holds the start
     * for a person. `stopped` is the person stopping it while the source still describes. Nothing of the answer runs.
     */
    machineStart(
        source: string,
        candidate: string,
        stopped: boolean
    ): Promise<{ start: Server.MachineStart | null; reports: string[]; failure: string | null }>;
    /*
     * Hands a notification channel a notification about `node-1` of `project`, as the machine does once it decided one
     * goes out. Answers the channel's title and whether it delivered. Rejects for a channel the extension does not supply.
     */
    notify(channel: string, body: string, reason: Server.Notification['reason']): Promise<{ title: string; delivered: boolean }>;
    /* A launch of `project` changed what it does, as the machine's runner says it. */
    launchIs(launch: string, state: 'running' | 'exited', exitCode: number | null): void;
    /* A client opened `project`, or the last one closed it. */
    projectIs(open: boolean): void;
    /* What the problem sources hold of `project` now: per source and file, the message of each problem. */
    problems(): Promise<{ source: string; path: string; messages: string[] }[]>;
    /* Writes a text file of `project`, by its path in the folder, as a person saving it would. */
    writeFile(path: string, text: string): Promise<void>;
}

/* What a scenario puts in the manifest beside its permissions, and where the extension came from: a dev link unless it says installed. */
export interface WorldManifest {
    provides?: Record<string, string[]>;
    proposed?: string[];
    provenance?: 'installed';
}

export type OpenServerWorld = (permissions: Record<string, string>, manifest?: WorldManifest) => Promise<ServerWorld>;

const SENDS = { 'chats.send': 'Says hello' };
const TERMINALS = { 'canvas.write': 'Opens', 'terminals.write': 'Types', 'terminals.profiles': 'Adds a shell' };
const PROFILE: WorldManifest = { provides: { terminalProfiles: ['probe-shell'] }, proposed: ['terminalProfiles'] };
const PROVIDES = { 'launches.provide': 'Lists launches', 'problems.provide': 'Reports problems' };
const SOURCES: WorldManifest = {
    provides: { launchSources: ['probe-launches'], problemSources: ['probe-problems'] },
    proposed: ['launchSources', 'problemSources']
};
const MACHINES = { 'machines.provide': 'Lists machines' };
const MACHINE_SOURCES: WorldManifest = { provides: { machineSources: ['probe-machines'] }, proposed: ['machineSources'] };
const NOTIFIES = { 'notifications.provide': 'Tells you elsewhere' };
const CHANNELS: WorldManifest = { provides: { notificationChannels: ['probe-channel'] }, proposed: ['notificationChannels'] };
const NOT_FINAL =
    'This extension uses a part of Ruimte that is not final yet (terminalProfiles). It works while its author develops it, and an installed extension cannot use it.';

function denied(permission: string): Server.Result<unknown> {
    return {
        ok: true,
        value: { ok: false, error: { code: 'permission-denied', message: `${ID} did not ask for the permission ${permission} in its manifest` } }
    };
}

function refusedWith(message: string): Server.Result<unknown> {
    return { ok: true, value: { ok: false, error: { code: 'refused', message } } };
}

function terminalOf(opened: Server.Result<unknown>): string {
    const answer = opened.ok ? (opened.value as Server.Result<Server.NodeRef>) : opened;

    if (!answer.ok) {
        throw new Error(answer.error.message);
    }

    return answer.value.id;
}

export function serverContract(open: OpenServerWorld): void {
    describe('the server contract', () => {
        test('hears a machine event only with its permission, and says why not in the log', async () => {
            const allowed = await open({ 'chats.read': 'Hears' });
            const refused = await open({});

            expect(await allowed.call('heard')).toEqual({ ok: true, value: [] });
            expect(await refused.call('heard')).toEqual({ ok: true, value: [] });

            allowed.fire('chat.event', { chatId: 'chat-1' });
            refused.fire('chat.event', { chatId: 'chat-1' });

            expect(await allowed.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
            expect(await refused.call('heard')).toEqual({ ok: true, value: [] });
            expect(await refused.logs()).toContain('chat.event needs the permission chats.read in manifest.json');
        });

        test('hears no more of an event once it stops following it', async () => {
            const world = await open({ 'chats.read': 'Hears' });

            // A first call, so `server/` runs and follows the event before it is fired.
            expect(await world.call('heard')).toEqual({ ok: true, value: [] });

            world.fire('chat.event', { chatId: 'chat-1' });

            expect(await world.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
            expect(await world.call('deaf')).toEqual({ ok: true, value: null });

            world.fire('chat.event', { chatId: 'chat-2' });

            expect(await world.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
        });

        test('reads a key it deleted as one it never wrote', async () => {
            const world = await open({});

            expect(await world.call('keep', 'count', 2)).toEqual({ ok: true, value: null });
            expect(await world.call('kept', 'count')).toEqual({ ok: true, value: 2 });
            expect(await world.call('forget', 'count')).toEqual({ ok: true, value: null });
            expect(await world.call('kept', 'count')).toEqual({ ok: true, value: null });
        });

        test('reads no key it never wrote, also one every object has', async () => {
            const world = await open({});

            expect(await world.call('kept', 'constructor')).toEqual({ ok: true, value: null });
            expect(await world.call('kept', '__proto__')).toEqual({ ok: true, value: null });
            expect(await world.call('kept', 'toString')).toEqual({ ok: true, value: null });
        });

        test('goes on after its own code prints, also what reads as a message', async () => {
            const world = await open({});

            expect(await world.call('prints')).toEqual({ ok: true, value: 'printed' });
            expect(await world.call('loads')).toEqual({ ok: true, value: [1, 1] });
        });

        test('answers what its module awaits as it loads, and keeps what it stored then', async () => {
            const world = await open({});

            expect(await world.call('loads')).toEqual({ ok: true, value: [1, 1] });
        });

        test('answers an agent through its tool, and has no tool without agents.tools', async () => {
            const offered = await open({ 'agents.tools': 'Offers' });
            const hidden = await open({});

            expect(await offered.tool('echo', { text: 'Hi' }, 'chat-9')).toBe('Hi, for chat-9');
            await expect(hidden.tool('echo', { text: 'Hi' }, 'chat-9')).rejects.toThrow(`No tool ${ID}/echo. tool_list says what there is`);
        });

        test('sends a chat at most 20 messages an hour, each with value undefined', async () => {
            const world = await open(SENDS);
            const sent: Server.Result<unknown>[] = [];

            for (let send = 0; send < 21; send++) {
                sent.push(await world.call('send', 'chat-1'));
            }

            expect(sent.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => ({ ok: true, value: { ok: true, keys: ['ok', 'value'], value: 'undefined' } })));
            expect(sent[20]).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'limit', message: `${ID} sent chat-1 20 messages this hour and has to wait` } }
            });
        });

        test('refuses what the manifest does not ask for, in the words of the machine', async () => {
            const world = await open({});

            expect(await world.call('send', 'chat-1')).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'permission-denied', message: `${ID} did not ask for the permission chats.send in its manifest` } }
            });
        });

        test('asks an agent and lists the chats, each only with its permission', async () => {
            const allowed = await open({ 'agents.run': 'Asks', 'chats.read': 'Lists' });
            const refused = await open({});

            expect(await allowed.call('asks', 'Hi')).toEqual({ ok: true, value: { ok: true, value: { text: 'Answer to Hi' } } });
            expect(await allowed.call('chatIds')).toEqual({ ok: true, value: ['chat-1'] });
            expect(await refused.call('asks', 'Hi')).toEqual(denied('agents.run'));
            expect(await refused.call('chatIds')).toEqual(denied('chats.read'));
        });

        test('keeps a secret apart from what it stores, and writes what it logs', async () => {
            const world = await open({});

            expect(await world.call('hide', 'hunter2')).toEqual({ ok: true, value: ['hunter2', null] });
            expect(await world.logs()).toContain('Kept a secret');
        });

        test('says an event without a payload as one a client hears with none', async () => {
            const world = await open({});

            expect(await world.call('finish')).toEqual({ ok: true, value: null });
            expect(await world.emitted()).toStrictEqual([{ name: 'done' }, { name: 'counted', payload: { count: 1 } }]);
        });

        test('starts a chat a person sees with agents.start, and none without it', async () => {
            const allowed = await open({ 'agents.start': 'Starts a chat' });
            const refused = await open({});

            expect(await allowed.call('startsChat', allowed.project)).toEqual({ ok: true, value: { ok: true, value: { id: expect.any(String) } } });
            expect(await refused.call('startsChat', refused.project)).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'permission-denied', message: `${ID} did not ask for the permission agents.start in its manifest` } }
            });
        });

        test('opens a terminal with its profile, and types only into a terminal it opened itself', async () => {
            const world = await open(TERMINALS, PROFILE);
            const opened = await world.call('opensShell', world.project);

            expect(opened).toEqual({ ok: true, value: { ok: true, value: { id: expect.any(String) } } });

            const shell = terminalOf(opened);
            const plain = terminalOf(await world.call('opensPlain', world.project));

            expect(await world.variable(shell, 'PROBE_PROJECT')).toBe(world.project);
            expect(await world.variable(plain, 'PROBE_PROJECT')).toBeUndefined();
            expect(await world.call('types', shell, 'ls\n')).toEqual({ ok: true, value: { ok: true, keys: ['ok', 'value'], value: 'undefined' } });
            expect(await world.call('types', plain, 'pwd\n')).toMatchObject({ ok: true, value: { ok: true } });
            expect([await world.typed(shell), await world.typed(plain)]).toEqual(['ls\n', 'pwd\n']);
            expect(await world.call('types', world.personTerminal, 'ls\n')).toEqual(
                refusedWith(`${ID} did not open the terminal ${world.personTerminal}, so it cannot type into it`)
            );
            expect(await world.call('types', 'nowhere', 'ls\n')).toEqual(refusedWith(`${ID} did not open the terminal nowhere, so it cannot type into it`));
            expect(await world.typed(world.personTerminal)).toBe('');
        });

        test('types into its own terminal no more while an agent there waits for the person', async () => {
            const world = await open(TERMINALS, PROFILE);
            const shell = terminalOf(await world.call('opensPlain', world.project));

            await world.waits(shell);

            expect(await world.call('types', shell, 'y\n')).toEqual(
                refusedWith(`An agent in the terminal ${shell} waits for the person, so nothing is typed into it`)
            );
            expect(await world.typed(shell)).toBe('');
        });

        test('opens, types into and reads a terminal each only with its permission', async () => {
            const allowed = await open({ 'terminals.read': 'Reads' });
            const refused = await open({});

            expect(await allowed.call('reads', allowed.personTerminal)).toEqual({ ok: true, value: { ok: true, value: 'The screen' } });
            expect(await refused.call('reads', refused.personTerminal)).toEqual(denied('terminals.read'));
            expect(await refused.call('opensPlain', refused.project)).toEqual(denied('canvas.write'));
            expect(await refused.call('types', refused.personTerminal, 'ls\n')).toEqual(denied('terminals.write'));
        });

        test('defines a terminal profile only when its manifest asks for it, names it as proposed and lists it', async () => {
            const allowed = await open(TERMINALS, PROFILE);
            const unasked = await open({});
            const unnamed = await open(TERMINALS);
            const unlisted = await open(TERMINALS, { provides: { terminalProfiles: ['another'] }, proposed: ['terminalProfiles'] });

            expect(await allowed.call('profileRefused')).toEqual({ ok: true, value: null });
            expect(await unasked.call('profileRefused')).toEqual({
                ok: true,
                value: `${ID} did not ask for the permission terminals.profiles in its manifest`
            });
            expect(await unnamed.call('profileRefused')).toEqual({
                ok: true,
                value: 'defineTerminalProfile is still proposed; name terminalProfiles under proposed in manifest.json'
            });
            expect(await unlisted.call('profileRefused')).toEqual({
                ok: true,
                value: 'defineTerminalProfile got probe-shell, which manifest.json does not list under provides.terminalProfiles'
            });
            expect(await unlisted.call('opensShell', unlisted.project)).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'not-found', message: `${ID} supplies no terminal profile probe-shell` } }
            });
        });

        test('does not load with a proposed part as an extension a person installed', async () => {
            await expect(open(TERMINALS, { ...PROFILE, provenance: 'installed' })).rejects.toThrow(NOT_FINAL);
            await expect(open(TERMINALS, { proposed: ['terminalProfiles'], provenance: 'installed' })).rejects.toThrow(NOT_FINAL);
        });

        test('lists its launches for the machine to start, and tells when they change until it is asked to stop', async () => {
            const world = await open(PROVIDES, SOURCES);

            expect(await world.launches('probe-launches')).toEqual({
                title: 'Probe launches',
                launches: [
                    { id: 'serve', name: 'Serve', kind: 'service', spawn: { command: 'sh', args: ['-c', 'serve'] }, fingerprint: 'revision-1', port: 4000 }
                ]
            });
            expect(await world.logs()).toContainEqual(expect.stringMatching(/^probe-launches listed a launch that is none: id /));
            expect(await world.call('bump')).toEqual({ ok: true, value: null });
            expect(await world.launchChanges('probe-launches')).toBe(1);
            expect((await world.launches('probe-launches')).launches[0]?.fingerprint).toBe('revision-2');

            await world.unfollowLaunches('probe-launches');
            await world.call('bump');

            expect(await world.launchChanges('probe-launches')).toBe(1);
        });

        test('defines a launch source and a problem source only when its manifest asks for each, names it as proposed and lists it', async () => {
            const allowed = await open(PROVIDES, SOURCES);
            const unasked = await open({});
            const unnamed = await open(PROVIDES);
            const unlisted = await open(PROVIDES, { provides: { launchSources: ['another'], problemSources: ['another'] }, proposed: SOURCES.proposed ?? [] });

            expect(await allowed.call('sourcesRefused')).toEqual({ ok: true, value: { launches: null, problems: null } });
            expect(await unasked.call('sourcesRefused')).toEqual({
                ok: true,
                value: {
                    launches: `${ID} did not ask for the permission launches.provide in its manifest`,
                    problems: `${ID} did not ask for the permission problems.provide in its manifest`
                }
            });
            expect(await unnamed.call('sourcesRefused')).toEqual({
                ok: true,
                value: {
                    launches: 'defineLaunchSource is still proposed; name launchSources under proposed in manifest.json',
                    problems: 'defineProblemSource is still proposed; name problemSources under proposed in manifest.json'
                }
            });
            expect(await unlisted.call('sourcesRefused')).toEqual({
                ok: true,
                value: {
                    launches: 'defineLaunchSource got probe-launches, which manifest.json does not list under provides.launchSources',
                    problems: 'defineProblemSource got probe-problems, which manifest.json does not list under provides.problemSources'
                }
            });
            expect(await unlisted.call('reports', unlisted.project, 'probe-problems', [])).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'not-found', message: `${ID} supplies no problem source probe-problems` } }
            });
        });

        test('lists the places of a machine source, and describes a start for the machine to run until the person stops it', async () => {
            const world = await open(MACHINES, MACHINE_SOURCES);

            expect(await world.machines('probe-machines')).toEqual({
                title: 'Probe machines',
                candidates: [
                    { id: 'box', title: 'Box', place: 'A box on this computer', running: false },
                    { id: 'slow', title: 'Slow', place: 'A box that takes its time', running: false },
                    { id: 'broken', title: 'Broken', place: 'A box with nothing to run', running: true }
                ]
            });
            expect(await world.logs()).toContainEqual(expect.stringMatching(/^probe-machines listed a place that is none: id /));
            // A description only: the source is handed no way to run it, and no key, token or connection of the machine it starts.
            expect(await world.machineStart('probe-machines', 'box', false)).toEqual({
                start: {
                    steps: [{ title: 'Start the box', spawn: { command: 'sh', args: ['-c', 'box up'] } }],
                    login: { command: 'sh', args: ['-c', 'box login'] },
                    fingerprint: 'revision-1'
                },
                reports: ['Describing box'],
                failure: null
            });
            expect(await world.machineStart('probe-machines', 'slow', true)).toMatchObject({ start: null, failure: 'Stopped by the person' });
            expect((await world.machineStart('probe-machines', 'broken', false)).failure).toStartWith('described a start that is none: steps ');
        });

        test('defines a machine source only when its manifest asks for it, names it as proposed and lists it', async () => {
            const allowed = await open(MACHINES, MACHINE_SOURCES);
            const unasked = await open({});
            const unnamed = await open(MACHINES);
            const unlisted = await open(MACHINES, { provides: { machineSources: ['another'] }, proposed: ['machineSources'] });

            expect(await allowed.call('machineSourceRefused')).toEqual({ ok: true, value: null });
            expect(await unasked.call('machineSourceRefused')).toEqual({
                ok: true,
                value: `${ID} did not ask for the permission machines.provide in its manifest`
            });
            expect(await unnamed.call('machineSourceRefused')).toEqual({
                ok: true,
                value: 'defineMachineSource is still proposed; name machineSources under proposed in manifest.json'
            });
            expect(await unlisted.call('machineSourceRefused')).toEqual({
                ok: true,
                value: 'defineMachineSource got probe-machines, which manifest.json does not list under provides.machineSources'
            });
            await expect(unlisted.machines('probe-machines')).rejects.toThrow();
            await expect(open(MACHINES, { ...MACHINE_SOURCES, provenance: 'installed' })).rejects.toThrow(
                'This extension uses a part of Ruimte that is not final yet (machineSources).'
            );
        });

        test('hands a notification channel what to tell a person, and keeps a channel that throws to its own log', async () => {
            const world = await open(NOTIFIES, CHANNELS);

            expect(await world.notify('probe-channel', 'The agent needs your attention.', 'needsYou')).toEqual({ title: 'Probe channel', delivered: true });
            expect(await world.notify('probe-channel', 'The turn is done.', 'done')).toEqual({ title: 'Probe channel', delivered: true });
            expect(await world.call('delivered')).toEqual({
                ok: true,
                value: [
                    { title: 'Agent', body: 'The agent needs your attention.', project: { id: world.project }, node: { id: 'node-1' }, reason: 'needsYou' },
                    { title: 'Agent', body: 'The turn is done.', project: { id: world.project }, node: { id: 'node-1' }, reason: 'done' }
                ]
            });
            // A channel that fails loses that one notification, and the next one still reaches it.
            expect(await world.notify('probe-channel', 'fail', 'limit')).toEqual({ title: 'Probe channel', delivered: false });
            expect(await world.logs()).toContainEqual(expect.stringContaining('did not deliver a notification: The channel is down'));
            expect((await world.notify('probe-channel', 'Back again.', 'limit')).delivered).toBe(true);
        });

        test('defines a notification channel only when its manifest asks for it, names it as proposed and lists it', async () => {
            const allowed = await open(NOTIFIES, CHANNELS);
            const unasked = await open({});
            const unnamed = await open(NOTIFIES);
            const unlisted = await open(NOTIFIES, { provides: { notificationChannels: ['another'] }, proposed: ['notificationChannels'] });

            expect(await allowed.call('channelRefused')).toEqual({ ok: true, value: null });
            expect(await unasked.call('channelRefused')).toEqual({
                ok: true,
                value: `${ID} did not ask for the permission notifications.provide in its manifest`
            });
            expect(await unnamed.call('channelRefused')).toEqual({
                ok: true,
                value: 'defineNotificationChannel is still proposed; name notificationChannels under proposed in manifest.json'
            });
            expect(await unlisted.call('channelRefused')).toEqual({
                ok: true,
                value: 'defineNotificationChannel got probe-channel, which manifest.json does not list under provides.notificationChannels'
            });
            await expect(unlisted.notify('probe-channel', 'Hello', 'done')).rejects.toThrow();
            await expect(open(NOTIFIES, { ...CHANNELS, provenance: 'installed' })).rejects.toThrow(
                'This extension uses a part of Ruimte that is not final yet (notificationChannels).'
            );
        });

        test('reports the problems of a source file by file, replaces what it said of a file and takes it all back', async () => {
            const world = await open(PROVIDES, SOURCES);
            const todo = { line: 2, column: 4, severity: 'warning', message: 'A TODO is left here', code: 'todo' };
            const long = { line: 9, severity: 'hint', message: 'This line is long' };

            expect(
                await world.call('reports', world.project, 'probe-problems', [
                    { path: 'src/a.ts', problems: [todo, long] },
                    { path: 'src/b.ts', problems: [long] }
                ])
            ).toEqual({ ok: true, value: { ok: true, keys: ['ok', 'value'], value: 'undefined' } });
            expect(await world.problems()).toEqual([
                { source: 'probe-problems', path: 'src/a.ts', messages: ['A TODO is left here', 'This line is long'] },
                { source: 'probe-problems', path: 'src/b.ts', messages: ['This line is long'] }
            ]);

            // Only the files a report names: `a.ts` is replaced, `b.ts` stays, and a file with nothing is cleared.
            await world.call('reports', world.project, 'probe-problems', [{ path: 'src/a.ts', problems: [long] }]);

            expect((await world.problems()).map((file) => [file.path, file.messages.length])).toEqual([
                ['src/a.ts', 1],
                ['src/b.ts', 1]
            ]);

            await world.call('reports', world.project, 'probe-problems', [{ path: 'src/b.ts', problems: [] }]);

            expect((await world.problems()).map((file) => file.path)).toEqual(['src/a.ts']);
            expect(await world.call('clears', world.project, 'probe-problems')).toMatchObject({ ok: true, value: { ok: true } });
            expect(await world.problems()).toEqual([]);
        });

        test('reports no problem without its permission, outside the project or past what the machine holds of one file', async () => {
            const world = await open(PROVIDES, SOURCES);
            const refused = await open({});
            const many = Array.from({ length: 201 }, (_, index) => ({ line: index + 1, severity: 'hint', message: 'Too much' }));

            expect(await refused.call('reports', refused.project, 'probe-problems', [])).toEqual(denied('problems.provide'));
            expect(await refused.call('clears', refused.project, 'probe-problems')).toEqual(denied('problems.provide'));
            expect(await world.call('reports', world.project, 'probe-problems', [{ path: '../elsewhere.ts', problems: [many[0]] }])).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'outside-project', message: '../elsewhere.ts is outside the project folder' } }
            });
            expect(await world.call('reports', world.project, 'probe-problems', [{ path: 'src/a.ts', problems: many }])).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'limit', message: 'A source reports at most 200 problems per file and 500 files at once' } }
            });
            expect(await world.problems()).toEqual([]);
        });

        test('reads and lists the files of a project, and hears a file change until it stops following it', async () => {
            const world = await open({ 'files.read': 'Reads' });

            await world.writeFile('notes/today.md', 'Hello');
            await world.writeFile('notes/sub/deep.md', 'Deep');

            expect(await world.call('readsFile', world.project, 'notes/today.md')).toEqual({ ok: true, value: { ok: true, value: 'Hello' } });
            expect(await world.call('listsFolder', world.project, 'notes')).toEqual({ ok: true, value: ['directory sub', 'file today.md'] });
            expect(await world.call('watchesFile', world.project, 'notes/today.md')).toEqual({ ok: true, value: null });

            await world.writeFile('notes/today.md', 'Hello again');
            await world.writeFile('notes/sub/deep.md', 'Deeper');

            expect(await world.call('readsFile', world.project, 'notes/today.md')).toEqual({ ok: true, value: { ok: true, value: 'Hello again' } });
            expect(await world.call('fileChanges', 'notes/today.md')).toEqual({ ok: true, value: 1 });
            expect(await world.call('unwatchesFile', 'notes/today.md')).toEqual({ ok: true, value: null });

            await world.writeFile('notes/today.md', 'Hello once more');

            expect(await world.call('fileChanges', 'notes/today.md')).toEqual({ ok: true, value: 1 });
        });

        test('reads, lists and follows no file without files.read, and none outside the project', async () => {
            const allowed = await open({ 'files.read': 'Reads' });
            const refused = await open({});
            const outside: Server.Result<unknown> = {
                ok: true,
                value: { ok: false, error: { code: 'outside-project', message: '../secret is outside the project folder' } }
            };

            expect(await refused.call('readsFile', refused.project, 'notes.md')).toEqual(denied('files.read'));
            expect(await refused.call('listsFolder', refused.project, '.')).toEqual(denied('files.read'));
            expect(await refused.call('watchesFile', refused.project, 'notes.md')).toEqual(denied('files.read'));
            expect(await allowed.call('readsFile', allowed.project, '../secret')).toEqual(outside);
            expect(await allowed.call('listsFolder', allowed.project, '../secret')).toEqual(outside);
            expect(await allowed.call('watchesFile', allowed.project, '../secret')).toEqual(outside);
        });

        test('hears a launch change and a project open and close in a shape of its own, each only with its permission', async () => {
            const allowed = await open({ 'launches.read': 'Follows launches', 'projects.read': 'Follows projects' });
            const refused = await open({});

            // A first call, so `server/` runs and follows the events before they are fired.
            await allowed.call('machineHeard');
            await refused.call('machineHeard');

            for (const world of [allowed, refused]) {
                world.projectIs(true);
                world.launchIs('web', 'running', null);
                world.launchIs('web', 'exited', 1);
                world.projectIs(false);
            }

            const project = { id: allowed.project };

            expect(await allowed.call('machineHeard')).toEqual({
                ok: true,
                value: {
                    heard: [
                        { 'project.opened': { project: { id: allowed.project, name: expect.any(String), folder: expect.any(String) } } },
                        { 'launch.status': { project, launch: 'web', state: 'running', exitCode: null } },
                        { 'launch.status': { project, launch: 'web', state: 'exited', exitCode: 1 } },
                        { 'project.closed': { project } }
                    ],
                    // Its filter names another project, so it hears none of this one.
                    elsewhere: []
                }
            });
            expect(await refused.call('machineHeard')).toEqual({ ok: true, value: { heard: [], elsewhere: [] } });
            expect(await refused.logs()).toEqual(
                expect.arrayContaining([
                    'launch.status needs the permission launches.read in manifest.json',
                    'project.opened needs the permission projects.read in manifest.json',
                    'project.closed needs the permission projects.read in manifest.json'
                ])
            );
        });

        test("checks a machine action's input, and throws for one of the wrong shape", async () => {
            const world = await open({ 'launches.run': 'Starts' });

            expect(await world.call('start', { launch: 'web' })).toEqual({ ok: true, value: { ok: true, value: { id: 'web', name: 'web' } } });
            expect(await world.call('start', {})).toEqual({ ok: true, value: expect.stringMatching(/^TypeError: launch\.start takes another input: /) });
            expect(await world.call('missing')).toEqual({ ok: false, error: { code: 'not-found', message: 'No method missing' } });
        });
    });
}
