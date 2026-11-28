import { createHash } from 'node:crypto';
import { CodedError } from '@adecore/agents';
import {
    MACHINE_START_LINE_LENGTH,
    MACHINE_START_LINES,
    type MachineCandidate,
    type MachineSourceRef,
    type MachineStartHeld,
    type MachineStartProgram,
    type MachineStartState
} from '@ruimte/contracts';
import { RegisterMachinePayloadSchema, type RegisterMachinePayload } from '@ruimte/pulsar';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { quote } from '../providers/launch.ts';
import type { SessionSink } from '../wire.ts';
import type { MachineCandidateDescription, MachineStartDescription, SpawnDescription } from './descriptions.ts';
import type { RunMachineStep } from './machine-steps.ts';

/* A project as a machine source is asked about it. */
interface SourceProject {
    id: string;
    name: string;
    folder: string;
}

interface SourceListing {
    extension: string;
    source: string;
    title: string;
    candidates: MachineCandidateDescription[];
}

/* What the machine sources ask of the extensions: what each lists in a project, and what starts a machine in one of those places. */
export interface MachineSourceHost {
    list(project: SourceProject): Promise<SourceListing[]>;
    start(
        extension: string,
        source: string,
        project: SourceProject,
        candidate: MachineCandidateDescription,
        hooks: { report(line: string): void; signal: AbortSignal }
    ): Promise<MachineStartDescription>;
}

/* The ledger a person's yes is kept in, which is the one a launch of a source is held by. */
interface Approvals {
    has(folder: string, nodeId: string, command: string): boolean;
    approve(folder: string, nodeId: string, command: string): Promise<void>;
}

interface MachineSourcesOptions {
    host: MachineSourceHost;
    projectOf(projectId: string): Promise<SourceProject | null>;
    approvals: Approvals;
    run: RunMachineStep;
    /* What every program starts from, under the variables its description sets. */
    env: Record<string, string | undefined>;
    /* The folder a program runs in, held to the project and its worktrees; throws for one outside. */
    cwdOf(folder: string, cwd: string | undefined): Promise<string>;
    /* The account this machine is on, which is the one a machine it starts joins; null on none. */
    account(): Promise<string | null>;
    /* How this machine is reached now, as variables for every program of a start ({@link reachEnv}). */
    reach(): Record<string, string | undefined>;
}

export interface MachineCandidateTarget {
    projectId: string;
    extension: string;
    source: string;
    candidate: string;
}

export class MachineSourceError extends CodedError<'not-found' | 'machine-running' | 'start-under-way' | 'not-joining' | 'other-account'> {}

interface Listed {
    source: MachineSourceRef;
    description: MachineCandidateDescription;
}

interface Program {
    shown: MachineStartProgram;
    command: string;
    args: readonly string[];
}

/* What has the new machine sign itself onto an account, and which account a person approved that for. */
interface Joiner {
    program: Program;
    accountId: string;
}

interface Start {
    projectId: string;
    listed: Listed;
    state: MachineStartState;
    lines: string[];
    failure: string | null;
    held: MachineStartHeld | null;
    abort: AbortController;
    // Kept after the start signed, so a client that comes later can have the new machine sign again.
    joiner: Joiner | null;
    join: 'signed' | 'joined' | null;
    // What the new machine signed, until the first client took it to post.
    registration: RegisterMachinePayload | null;
    signing: Promise<RegisterMachinePayload> | null;
}

/* What Ruimte runs in the place a new machine lives, after what the source said gets a program in there. */
export const JOIN_COMMAND: readonly string[] = ['ruimte', 'join'];

const ACTIVE: readonly MachineStartState[] = ['preparing', 'starting', 'joining'];
// A part a shell reads as one word as it stands, so a person reads the approval as the source wrote it.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function keyOf({ projectId, extension, source, candidate }: MachineCandidateTarget): string {
    return [projectId, extension, source, candidate].join('\n');
}

function approvalKeyOf(target: MachineCandidateTarget): string {
    return `machine-source:${target.extension}:${target.source}:${target.candidate}`;
}

function commandLine(spawn: SpawnDescription): string {
    return [spawn.command, ...(spawn.args ?? [])].map((part) => (PLAIN_WORD.test(part) ? part : quote(part))).join(' ');
}

/* What a yes covers: every program with its folder and variables, in order, and what the source said it read. */
function digestOf(programs: readonly Program[], fingerprint: string): string {
    const covered = programs.map(({ shown }) => [shown.command, shown.cwd, Object.entries(shown.env ?? {}).sort(), shown.join === true]);

    return createHash('sha256')
        .update(JSON.stringify([covered, fingerprint]))
        .digest('hex');
}

function viewOf(listed: Listed, start: Start | undefined): MachineCandidate {
    return {
        source: listed.source,
        id: listed.description.id,
        title: listed.description.title,
        place: listed.description.place,
        running: listed.description.running,
        state: start?.state ?? 'idle',
        ...(start?.held == null ? {} : { held: start.held }),
        lines: start?.lines ?? [],
        ...(start?.failure == null ? {} : { failure: start.failure }),
        ...(start?.join == null ? {} : { join: start.join })
    };
}

/*
 * The places the machine sources of extensions list in a project, and the start of a machine in one. A source only
 * describes: the programs it names run here, one after another, after a person on this machine approved them as they
 * stand. A source that also says how to run a command where the new machine lives has that machine join the account
 * this machine is on: after the programs, `ruimte join` runs in there for that account, and what it prints is the new
 * machine's own signed registration. This machine signs nothing, names no account but its own, and posts nothing: the
 * registration waits here for a client of the owner, which posts it with its own session. The extension sees none of
 * it. A start is kept in memory alone, and nothing here stops or removes what a start made: a stop asks the program
 * that runs to end, and that is all.
 */
export class MachineSources {
    private readonly sinks = new ClientSinks();
    private readonly starts = new Map<string, Start>();
    // The places a start is being read for, so a second ask for one does not run beside the first.
    private readonly claimed = new Set<string>();
    // The clients that asked what a project lists, which are the ones told how its starts go.
    private readonly watchers = new Map<string, Set<string>>();
    private readonly options: MachineSourcesOptions;

    constructor(options: MachineSourcesOptions) {
        this.options = options;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    detachAll(clientId: string): void {
        for (const [projectId, clients] of this.watchers) {
            clients.delete(clientId);

            if (clients.size === 0) {
                this.watchers.delete(projectId);
            }
        }
    }

    /* What the sources list in a project now, each place with how far its start is. The client that asks hears of every change after. */
    async list(projectId: string, clientId: string): Promise<MachineCandidate[]> {
        const project = await this.options.projectOf(projectId);

        if (project === null) {
            return [];
        }

        const watching = this.watchers.get(projectId) ?? new Set();

        watching.add(clientId);
        this.watchers.set(projectId, watching);

        return (await this.listed(project)).map((listed) => viewOf(listed, this.starts.get(keyOf({ projectId, ...targetOf(listed) }))));
    }

    /*
     * Asks the source what starts a machine in the place and runs it, or holds it for a person's yes. `approve` is that
     * yes, for the digest the person was shown: a source that describes something else by now is held again.
     */
    async start(target: MachineCandidateTarget, approve?: string): Promise<MachineCandidate> {
        const key = keyOf(target);

        if (this.claimed.has(key) || ACTIVE.includes(this.starts.get(key)?.state ?? 'idle')) {
            throw new MachineSourceError('start-under-way', 'This machine is already being started');
        }

        this.claimed.add(key);

        try {
            const project = await this.options.projectOf(target.projectId);
            const listed =
                project === null ? undefined : (await this.listed(project)).find((each) => keyOf({ projectId: project.id, ...targetOf(each) }) === key);

            if (project === null || listed === undefined) {
                throw new MachineSourceError('not-found', `${target.source} lists no place ${target.candidate} in this project`);
            }

            if (listed.description.running) {
                throw new MachineSourceError('machine-running', `A machine already runs in ${listed.description.title}`);
            }

            const start: Start = {
                projectId: target.projectId,
                listed,
                state: 'preparing',
                lines: [],
                failure: null,
                held: null,
                abort: new AbortController(),
                joiner: null,
                join: null,
                registration: null,
                signing: null
            };

            this.starts.set(key, start);
            this.tell(start);
            await this.prepare(target, project, start, approve);

            return viewOf(listed, start);
        } finally {
            this.claimed.delete(key);
        }
    }

    /* A person's stop: a held start is let go of, and one under way has its program asked to end. Nothing it made is removed. */
    stop(target: MachineCandidateTarget): void {
        const start = this.starts.get(keyOf(target));

        if (start === undefined || (start.state !== 'held' && !ACTIVE.includes(start.state))) {
            return;
        }

        start.abort.abort();

        // Nothing runs while a signed registration waits for a client, so no program is there to end the start.
        if (start.join === 'signed') {
            start.join = null;
            start.registration = null;
            this.settle(start, 'stopped');
        }
    }

    /*
     * What the new machine signed, for a client of the owner to post. `accountId` is the account that client is signed
     * in to: it is only compared, and never signed for. The first ask takes what the start had signed; one after it has
     * the new machine sign again, so a client that went away with the first loses nothing.
     */
    async registration(target: MachineCandidateTarget, accountId: string): Promise<RegisterMachinePayload> {
        const start = this.starts.get(keyOf(target));

        if (start === undefined || start.state !== 'joining' || start.join !== 'signed' || start.joiner === null) {
            throw new MachineSourceError('not-joining', 'No machine here waits to join an account');
        }

        if (accountId !== start.joiner.accountId) {
            throw new MachineSourceError('other-account', 'The machine on this computer is on another account than the one you are signed in to');
        }

        const signed = start.registration;

        if (signed !== null) {
            start.registration = null;

            return signed;
        }

        start.signing ??= this.sign(start, start.joiner).finally(() => {
            start.signing = null;
        });

        return start.signing;
    }

    /* A client posted the registration, so the new machine is on the account and the start is over. */
    joined(target: MachineCandidateTarget): void {
        const start = this.starts.get(keyOf(target));

        if (start?.state === 'joining' && start.join === 'signed') {
            start.join = 'joined';
            start.registration = null;
            this.settle(start, 'done');
        }
    }

    private async listed(project: SourceProject): Promise<Listed[]> {
        const listings = await this.options.host.list(project);

        return listings.flatMap((listing) =>
            listing.candidates.map((description) => ({ source: { extension: listing.extension, id: listing.source, title: listing.title }, description }))
        );
    }

    private async prepare(target: MachineCandidateTarget, project: SourceProject, start: Start, approve: string | undefined): Promise<void> {
        const { signal } = start.abort;
        const settle = (state: MachineStartState, failure: string | null = null): void => this.settle(start, state, failure);

        try {
            const described = await this.options.host.start(target.extension, target.source, project, start.listed.description, {
                report: (line) => this.say(start, line),
                signal
            });
            const { programs, joiner } = await this.programsOf(project, described);
            const approved = joiner === null ? programs : [...programs, joiner.program];
            const digest = digestOf(approved, described.fingerprint);

            if (signal.aborted) {
                settle('stopped');

                return;
            }

            if (approve === digest) {
                await this.options.approvals.approve(project.folder, approvalKeyOf(target), digest);
            }

            if (!this.options.approvals.has(project.folder, approvalKeyOf(target), digest)) {
                start.state = 'held';
                start.held = { digest, programs: approved.map((program) => program.shown) };
                this.tell(start);
                // A held start runs nothing, so letting go of it only clears the row.
                signal.addEventListener(
                    'abort',
                    () => {
                        start.lines = [];
                        settle('idle');
                    },
                    { once: true }
                );

                return;
            }

            start.joiner = joiner;
            settle('starting');
            void this.execute(programs, start);
        } catch (e) {
            settle(signal.aborted ? 'stopped' : 'failed', signal.aborted ? null : errorText(e));
        }
    }

    /*
     * The programs of a start as they run, and the one that has the new machine join. A start that joins is described
     * for the account this machine is on now, so the yes covers that account and a machine on none starts nothing.
     */
    private async programsOf(project: SourceProject, described: MachineStartDescription): Promise<{ programs: Program[]; joiner: Joiner | null }> {
        const programOf = async (spawn: SpawnDescription, title: string | null): Promise<Program> => ({
            command: spawn.command,
            args: spawn.args ?? [],
            shown: {
                ...(title === null ? { join: true } : { title }),
                command: commandLine(spawn),
                cwd: await this.options.cwdOf(project.folder, spawn.cwd),
                ...(spawn.env === undefined || Object.keys(spawn.env).length === 0 ? {} : { env: spawn.env })
            }
        });
        const programs = await Promise.all(described.steps.map((step) => programOf(step.spawn, step.title)));

        if (described.inside === undefined) {
            return { programs, joiner: null };
        }

        const accountId = await this.options.account();

        if (accountId === null) {
            throw new Error('This computer is on no account, so the new machine has none to join. Put this computer on your account first.');
        }

        const { inside } = described;

        return { programs, joiner: { accountId, program: await programOf({ ...inside, args: [...(inside.args ?? []), ...JOIN_COMMAND, accountId] }, null) } };
    }

    /* Runs the programs in order, and then has the new machine sign. Never rejects: how it ended is the state a person reads. */
    private async execute(programs: readonly Program[], start: Start): Promise<void> {
        const { signal } = start.abort;
        const settle = (state: MachineStartState, failure: string | null = null): void => this.settle(start, state, failure);
        const say = (line: string): void => this.say(start, line);

        try {
            for (const { command, args, shown } of programs) {
                say(shown.title ?? shown.command);

                const code = await this.options.run({ command, args, cwd: shown.cwd, env: this.envOf(shown) }, { line: say, signal });

                if (signal.aborted) {
                    settle('stopped');

                    return;
                }

                if (code !== 0) {
                    settle('failed', `${shown.title ?? shown.command} ended with ${code === null ? 'a signal' : `code ${code}`}`);

                    return;
                }
            }

            if (start.joiner === null) {
                settle('done');

                return;
            }

            settle('joining');
            start.registration = await this.sign(start, start.joiner);
            start.join = 'signed';
            this.tell(start);
        } catch (e) {
            settle(signal.aborted ? 'stopped' : 'failed', signal.aborted ? null : errorText(e));
        }
    }

    /*
     * Has the new machine sign itself onto the account the start was approved for, and reads what it printed. Only its
     * output is the registration, which no client is told as a line; what it wrote beside it is why it would not.
     */
    private async sign(start: Start, { program, accountId }: Joiner): Promise<RegisterMachinePayload> {
        const { command, args, shown } = program;
        const printed: string[] = [];
        let said: string | null = null;

        // A machine that left its account, or went to another, since the yes: that yes was for the account it read.
        if ((await this.options.account()) !== accountId) {
            throw new Error('This computer is no longer on the account this start was approved for. Start again.');
        }

        const code = await this.options.run(
            { command, args, cwd: shown.cwd, env: this.envOf(shown) },
            {
                line: (text, stream) => {
                    if (stream === 'out') {
                        printed.push(text);
                    } else {
                        said = text;
                        this.say(start, text);
                    }
                },
                signal: start.abort.signal
            }
        );

        if (code !== 0) {
            throw new Error(said ?? `The new machine did not join: its answer ended with ${code === null ? 'a signal' : `code ${code}`}`);
        }

        const registration = RegisterMachinePayloadSchema.safeParse(parsedOrNull(printed.join('\n')));

        if (!registration.success) {
            throw new Error('The new machine answered with something Ruimte cannot read, so it is on no account.');
        }

        // A person approved this start, so it never counts as a client adding a machine by itself.
        const { automatic: _automatic, ...signed } = registration.data;

        return signed;
    }

    /* What a program runs with: the machine's own variables, how this machine is reached, and what the source set on top. */
    private envOf(shown: MachineStartProgram): Record<string, string | undefined> {
        return { ...this.options.env, ...this.options.reach(), ...shown.env };
    }

    private settle(start: Start, state: MachineStartState, failure: string | null = null): void {
        start.state = state;
        start.failure = failure;
        start.held = null;
        this.tell(start);
    }

    private say(start: Start, line: string): void {
        start.lines = [...start.lines, line.slice(0, MACHINE_START_LINE_LENGTH)].slice(-MACHINE_START_LINES);
        this.tell(start);
    }

    private tell(start: Start): void {
        for (const clientId of this.watchers.get(start.projectId) ?? []) {
            this.sinks.to(clientId, { event: 'extension.machineChanged', payload: { projectId: start.projectId, candidate: viewOf(start.listed, start) } });
        }
    }
}

/*
 * The broker this machine dials, under the names a daemon reads its own from, so a source hands them to the machine it
 * starts and the app that reaches this one reaches that one. A source cannot ask for them: which broker a person's
 * machines are on is this machine's to say. `off` for a machine on none, since a daemon that is told nothing announces
 * itself to the public broker.
 */
export function reachEnv(dialUrl: string | null, advertisedUrl: string | null): Record<string, string | undefined> {
    return {
        RUIMTE_BROKER_URL: dialUrl ?? 'off',
        RUIMTE_BROKER_ADVERTISE_URL: dialUrl !== null && advertisedUrl !== null && advertisedUrl !== dialUrl ? advertisedUrl : undefined
    };
}

function parsedOrNull(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function targetOf(listed: Listed): Omit<MachineCandidateTarget, 'projectId'> {
    return { extension: listed.source.extension, source: listed.source.id, candidate: listed.description.id };
}
