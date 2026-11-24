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
}

export interface MachineCandidateTarget {
    projectId: string;
    extension: string;
    source: string;
    candidate: string;
}

export class MachineSourceError extends CodedError<'not-found' | 'machine-running' | 'start-under-way'> {}

interface Listed {
    source: MachineSourceRef;
    description: MachineCandidateDescription;
}

interface Start {
    state: MachineStartState;
    lines: string[];
    failure: string | null;
    held: MachineStartHeld | null;
    abort: AbortController;
}

interface Program {
    shown: MachineStartProgram;
    command: string;
    args: readonly string[];
}

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
    const covered = programs.map(({ shown }) => [shown.command, shown.cwd, Object.entries(shown.env ?? {}).sort(), shown.login === true]);

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
        ...(start?.failure == null ? {} : { failure: start.failure })
    };
}

/*
 * The places the machine sources of extensions list in a project, and the start of a machine in one. A source only
 * describes: the programs it names run here, one after another, after a person on this machine approved them as they
 * stand. The last one may be the new machine's own `ruimte login`, whose lines a person reads and acts on; that is the
 * only way the machine gets on an account, and this class never learns who it is. A start is kept in memory alone, and
 * nothing here stops or removes what a start made: a stop asks the program that runs to end, and that is all.
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

            const start: Start = { state: 'preparing', lines: [], failure: null, held: null, abort: new AbortController() };

            this.starts.set(key, start);
            this.tell(target.projectId, listed, start);
            await this.prepare(target, project, listed, start, approve);

            return viewOf(listed, start);
        } finally {
            this.claimed.delete(key);
        }
    }

    /* A person's stop: a held start is let go of, and one under way has its program asked to end. Nothing it made is removed. */
    stop(target: MachineCandidateTarget): void {
        const start = this.starts.get(keyOf(target));

        if (start !== undefined && (start.state === 'held' || ACTIVE.includes(start.state))) {
            start.abort.abort();
        }
    }

    private async listed(project: SourceProject): Promise<Listed[]> {
        const listings = await this.options.host.list(project);

        return listings.flatMap((listing) =>
            listing.candidates.map((description) => ({ source: { extension: listing.extension, id: listing.source, title: listing.title }, description }))
        );
    }

    private async prepare(target: MachineCandidateTarget, project: SourceProject, listed: Listed, start: Start, approve: string | undefined): Promise<void> {
        const { signal } = start.abort;
        const settle = (state: MachineStartState, failure: string | null = null): void => {
            start.state = state;
            start.failure = failure;
            start.held = null;
            this.tell(target.projectId, listed, start);
        };

        try {
            const described = await this.options.host.start(target.extension, target.source, project, listed.description, {
                report: (line) => this.say(target.projectId, listed, start, line),
                signal
            });
            const programs = await this.programsOf(project, described);
            const digest = digestOf(programs, described.fingerprint);

            if (signal.aborted) {
                settle('stopped');

                return;
            }

            if (approve === digest) {
                await this.options.approvals.approve(project.folder, approvalKeyOf(target), digest);
            }

            if (!this.options.approvals.has(project.folder, approvalKeyOf(target), digest)) {
                start.state = 'held';
                start.held = { digest, programs: programs.map((program) => program.shown) };
                this.tell(target.projectId, listed, start);
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

            settle('starting');
            void this.execute(programs, start, (line) => this.say(target.projectId, listed, start, line), settle);
        } catch (e) {
            settle(signal.aborted ? 'stopped' : 'failed', signal.aborted ? null : errorText(e));
        }
    }

    private async programsOf(project: SourceProject, described: MachineStartDescription): Promise<Program[]> {
        const programOf = async (spawn: SpawnDescription, title: string | null): Promise<Program> => ({
            command: spawn.command,
            args: spawn.args ?? [],
            shown: {
                ...(title === null ? { login: true } : { title }),
                command: commandLine(spawn),
                cwd: await this.options.cwdOf(project.folder, spawn.cwd),
                ...(spawn.env === undefined || Object.keys(spawn.env).length === 0 ? {} : { env: spawn.env })
            }
        });
        const programs = await Promise.all(described.steps.map((step) => programOf(step.spawn, step.title)));

        return described.login === undefined ? programs : [...programs, await programOf(described.login, null)];
    }

    /* Runs the programs in order. Never rejects: how it ended is the state a person reads. */
    private async execute(
        programs: readonly Program[],
        start: Start,
        say: (line: string) => void,
        settle: (state: MachineStartState, failure?: string | null) => void
    ): Promise<void> {
        const { signal } = start.abort;

        try {
            for (const { command, args, shown } of programs) {
                if (shown.login === true) {
                    settle('joining');
                } else {
                    say(shown.title ?? shown.command);
                }

                const code = await this.options.run({ command, args, cwd: shown.cwd, env: { ...this.options.env, ...shown.env } }, { line: say, signal });

                if (signal.aborted) {
                    settle('stopped');

                    return;
                }

                if (code !== 0) {
                    settle('failed', `${shown.title ?? 'Signing in'} ended with ${code === null ? 'a signal' : `code ${code}`}`);

                    return;
                }
            }

            settle('done');
        } catch (e) {
            settle(signal.aborted ? 'stopped' : 'failed', signal.aborted ? null : errorText(e));
        }
    }

    private say(projectId: string, listed: Listed, start: Start, line: string): void {
        start.lines = [...start.lines, line.slice(0, MACHINE_START_LINE_LENGTH)].slice(-MACHINE_START_LINES);
        this.tell(projectId, listed, start);
    }

    private tell(projectId: string, listed: Listed, start: Start): void {
        for (const clientId of this.watchers.get(projectId) ?? []) {
            this.sinks.to(clientId, { event: 'extension.machineChanged', payload: { projectId, candidate: viewOf(listed, start) } });
        }
    }
}

function targetOf(listed: Listed): Omit<MachineCandidateTarget, 'projectId'> {
    return { extension: listed.source.extension, source: listed.source.id, candidate: listed.description.id };
}
