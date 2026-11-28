import { createHash } from 'node:crypto';
import {
    MACHINE_START_LINE_LENGTH,
    MACHINE_START_LINES,
    type MachineCandidate,
    type MachineSourceRef,
    type MachineStartProgram,
    type MachineStartState
} from '@ruimte/contracts';
import type { DevcontainerStart } from '@ruimte/desktop-bridge';
import { describeDevcontainer, findDevcontainer, namesOf, type ReadText, type Spawn } from '@ruimte/devcontainer';
import { RegisterMachinePayloadSchema, type RegisterMachinePayload } from '@ruimte/pulsar';
import type { OriginAnswer, OriginFetch } from './linux-origin';
import type { RunProgram } from './program-run';

/* What the candidate of a start names as its source, since the app starts it and no extension does. */
export const DEVCONTAINER_SOURCE: MachineSourceRef = { extension: 'ruimte', id: 'devcontainer', title: 'Dev Containers' };

/* What runs where the new machine lives, after `inside`, for the account the page is signed in to. */
export const JOIN_COMMAND: readonly string[] = ['ruimte', 'join'];

const ACTIVE: readonly MachineStartState[] = ['preparing', 'starting', 'joining'];
// A part a shell reads as one word as it stands, so a person reads the approval as it will run.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
// As long as the machine takes one, and never read as a flag of `ruimte join`.
const ACCOUNT_ID = /^[^\s-]\S{0,63}$/;

export interface DevcontainerStartsOptions {
    run: RunProgram;
    /* Reads a file of a folder by its path from that folder. */
    readerOf(folder: string): ReadText;
    /* Where Ruimte for Linux comes from, asked anew for every description. */
    origin(): Promise<OriginAnswer>;
    /* Whether Docker is on this computer, without running it. */
    hasDocker(env: Record<string, string | undefined>): Promise<boolean>;
    /* What every program starts from. */
    env(): Promise<Record<string, string | undefined>>;
    publish(start: DevcontainerStart): void;
}

type Program =
    | { kind: 'spawn'; shown: MachineStartProgram; command: string; args: readonly string[] }
    | { kind: 'fetch'; shown: MachineStartProgram; fetch: OriginFetch };

interface Described {
    title: string;
    place: string;
    workspaceFolder: string;
    programs: Program[];
    joiner: Program & { kind: 'spawn' };
    digest: string;
    ignored: string[];
}

interface Start {
    id: string;
    folder: string;
    accountId: string;
    title: string;
    place: string;
    workspaceFolder: string | null;
    state: MachineStartState;
    lines: string[];
    failure: string | null;
    held: { digest: string; programs: MachineStartProgram[] } | null;
    abort: AbortController;
    join: 'signed' | 'joined' | null;
    registration: RegisterMachinePayload | null;
    machineId: string | null;
}

export class DevcontainerStartError extends Error {}

function quote(part: string): string {
    return `'${part.replaceAll("'", `'\\''`)}'`;
}

function commandLine(spawn: Spawn): string {
    return [spawn.command, ...(spawn.args ?? [])].map((part) => (PLAIN_WORD.test(part) ? part : quote(part))).join(' ');
}

/* What a yes covers: every program with its folder and variables, in order, and the files they were read from. */
function digestOf(programs: readonly Program[], fingerprint: string): string {
    const covered = programs.map(({ shown }) => [shown.command, shown.cwd, Object.entries(shown.env ?? {}).sort(), shown.join === true]);

    return createHash('sha256')
        .update(JSON.stringify([covered, fingerprint]))
        .digest('hex');
}

function baseName(folder: string): string {
    return folder.split(/[\\/]/).findLast((part) => part !== '') ?? 'project';
}

function messageOf(e: unknown): string {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
        return `${'path' in e && typeof e.path === 'string' ? e.path : 'A program'} is not on this computer.`;
    }

    return e instanceof Error ? e.message : String(e);
}

function parsedOrNull(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/*
 * The dev containers this app starts itself, in machine mode `none`: the shell reads the folder a person picked, shows
 * what would run, and runs it after the page's yes to the digest of exactly what it showed. A start that would run
 * something else by then is shown again. The new machine then signs itself onto the account the page named, and the
 * page posts that with its own session: the shell holds no token, signs nothing and posts nothing. Starts live in
 * memory, and nothing here stops or removes what a start made.
 */
export class DevcontainerStarts {
    private readonly starts = new Map<string, Start>();
    private readonly options: DevcontainerStartsOptions;

    constructor(options: DevcontainerStartsOptions) {
        this.options = options;
    }

    list(): DevcontainerStart[] {
        return [...this.starts.values()].map((start) => this.view(start));
    }

    /* Reads what a picked folder would run and holds it for a person's yes. A folder whose start is under way stays as it is. */
    async pick(folder: string, accountId: string): Promise<DevcontainerStart> {
        const id = (await namesOf(folder)).container;
        const known = this.starts.get(id);

        if (known !== undefined && ACTIVE.includes(known.state)) {
            return this.view(known);
        }

        const start: Start = {
            id,
            folder,
            accountId: accountOf(accountId),
            title: baseName(folder),
            place: id,
            workspaceFolder: null,
            state: 'preparing',
            lines: [],
            failure: null,
            held: null,
            abort: new AbortController(),
            join: null,
            registration: null,
            machineId: null
        };

        this.starts.set(id, start);
        this.tell(start);

        try {
            this.hold(start, await this.describe(start));
        } catch (e) {
            this.settle(start, 'failed', messageOf(e));
        }

        return this.view(start);
    }

    /* The page's yes to what was held under `digest`. What the folder would run now is read again and runs only when it is the same. */
    async start(id: string, accountId: string, digest: string): Promise<DevcontainerStart> {
        const start = this.startOf(id);

        if (ACTIVE.includes(start.state)) {
            throw new DevcontainerStartError('This machine is already being started');
        }

        start.accountId = accountOf(accountId);
        start.abort = new AbortController();
        start.join = null;
        start.registration = null;
        start.machineId = null;
        start.lines = [];
        this.settle(start, 'preparing');

        let described: Described;

        try {
            described = await this.describe(start);
        } catch (e) {
            this.settle(start, 'failed', messageOf(e));

            return this.view(start);
        }

        if (described.digest !== digest) {
            this.hold(start, described);

            return this.view(start);
        }

        this.settle(start, 'starting');
        void this.execute(start, described);

        return this.view(start);
    }

    /* A held start is let go of; one under way has its program asked to end, once. Nothing it made is removed. */
    stop(id: string): void {
        const start = this.starts.get(id);

        if (start === undefined) {
            return;
        }

        if (start.state === 'held') {
            start.lines = [];
            this.settle(start, 'idle');

            return;
        }

        if (!ACTIVE.includes(start.state)) {
            return;
        }

        start.abort.abort();

        // Nothing runs while a signed registration waits for the page, so no program is there to end the start.
        if (start.join === 'signed') {
            start.join = null;
            start.registration = null;
            this.settle(start, 'stopped');
        }
    }

    /* What the new machine signed, for the page to post. `accountId` is the account the page is signed in to now. */
    registration(id: string, accountId: string): RegisterMachinePayload {
        const start = this.startOf(id);

        if (start.state !== 'joining' || start.join !== 'signed' || start.registration === null) {
            throw new DevcontainerStartError('No machine here waits to join an account');
        }

        if (accountId !== start.accountId) {
            throw new DevcontainerStartError('The new machine signed for another account than the one you are signed in to now. Start it again.');
        }

        return start.registration;
    }

    joined(id: string): void {
        const start = this.startOf(id);

        if (start.state === 'joining' && start.join === 'signed') {
            start.join = 'joined';
            start.registration = null;
            this.settle(start, 'done');
        }
    }

    private startOf(id: string): Start {
        const start = this.starts.get(id);

        if (start === undefined) {
            throw new DevcontainerStartError('Ruimte knows no such folder. Choose it again.');
        }

        return start;
    }

    private async describe(start: Start): Promise<Described> {
        const env = await this.options.env();

        if (!(await this.options.hasDocker(env))) {
            throw new DevcontainerStartError('Ruimte cannot find Docker on this computer. Install Docker, start it, and try again.');
        }

        const readText = this.options.readerOf(start.folder);
        const found = await findDevcontainer(start.folder, readText);

        if (found === null) {
            throw new DevcontainerStartError('This folder has no .devcontainer/devcontainer.json and no .devcontainer.json.');
        }

        if (!found.read.ok) {
            throw new DevcontainerStartError(`Ruimte cannot start ${found.file}: ${found.read.reason}`);
        }

        const devcontainer = found.read.value;
        const title = devcontainer.name ?? baseName(start.folder);
        const origin = await this.options.origin();

        if (!origin.ok) {
            throw new DevcontainerStartError(origin.reason);
        }

        const described = await describeDevcontainer({ folder: start.folder, found, devcontainer, label: title, origin: origin.value.origin, readText });
        const spawned = (spawn: Spawn, title?: string): Program & { kind: 'spawn' } => ({
            kind: 'spawn',
            command: spawn.command,
            args: spawn.args ?? [],
            shown: {
                ...(title === undefined ? { join: true } : { title }),
                command: commandLine(spawn),
                cwd: spawn.cwd ?? start.folder,
                ...(spawn.env === undefined || Object.keys(spawn.env).length === 0 ? {} : { env: spawn.env })
            }
        });
        const { fetch } = origin.value;
        const programs: Program[] = [
            ...(fetch === null ? [] : [{ kind: 'fetch' as const, fetch, shown: { title: fetch.title, command: fetch.command, cwd: fetch.cwd } }]),
            ...described.steps.map((step) => spawned(step.spawn, step.title))
        ];
        const { inside } = described;
        const joiner = spawned({ ...inside, args: [...(inside.args ?? []), ...JOIN_COMMAND, start.accountId] });

        return {
            title,
            place: (await namesOf(start.folder)).container,
            workspaceFolder: devcontainer.workspaceFolder,
            programs,
            joiner,
            digest: digestOf([...programs, joiner], described.fingerprint),
            ignored: devcontainer.ignored
        };
    }

    private hold(start: Start, described: Described): void {
        start.title = described.title;
        start.place = described.place;
        start.workspaceFolder = described.workspaceFolder;

        if (described.ignored.length > 0) {
            this.say(start, `Ignoring what Ruimte does not read in devcontainer.json: ${described.ignored.join(', ')}`);
        }

        start.state = 'held';
        start.failure = null;
        start.held = { digest: described.digest, programs: [...described.programs, described.joiner].map((program) => program.shown) };
        this.tell(start);
    }

    /* Runs the programs in order, and then has the new machine sign. Never rejects: how it ended is the state a person reads. */
    private async execute(start: Start, { programs, joiner }: Described): Promise<void> {
        const { signal } = start.abort;
        const env = await this.options.env();
        const say = (line: string): void => this.say(start, line);

        try {
            for (const program of programs) {
                say(program.shown.title ?? program.shown.command);

                if (program.kind === 'fetch') {
                    await program.fetch.run({ line: say, signal });
                } else {
                    const code = await this.options.run(
                        { command: program.command, args: program.args, cwd: program.shown.cwd, env: { ...env, ...program.shown.env } },
                        { line: say, signal }
                    );

                    if (!signal.aborted && code !== 0) {
                        this.settle(
                            start,
                            'failed',
                            `${program.shown.title ?? program.shown.command} ended with ${code === null ? 'a signal' : `code ${code}`}`
                        );

                        return;
                    }
                }

                if (signal.aborted) {
                    this.settle(start, 'stopped');

                    return;
                }
            }

            this.settle(start, 'joining');
            start.registration = await this.sign(start, joiner, env);
            start.machineId = start.registration.id;
            start.join = 'signed';
            this.tell(start);
        } catch (e) {
            this.settle(start, signal.aborted ? 'stopped' : 'failed', signal.aborted ? null : messageOf(e));
        }
    }

    /* Has the new machine sign itself onto the account, and reads what it printed. What it wrote beside that is why it would not. */
    private async sign(start: Start, joiner: Program & { kind: 'spawn' }, env: Record<string, string | undefined>): Promise<RegisterMachinePayload> {
        const printed: string[] = [];
        let said: string | null = null;

        this.say(start, 'Putting the new machine on your account');

        const code = await this.options.run(
            { command: joiner.command, args: joiner.args, cwd: joiner.shown.cwd, env },
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
        this.options.publish(this.view(start));
    }

    private view(start: Start): DevcontainerStart {
        const candidate: MachineCandidate = {
            source: DEVCONTAINER_SOURCE,
            id: start.id,
            title: start.title,
            place: start.place,
            running: false,
            state: start.state,
            ...(start.held === null ? {} : { held: start.held }),
            lines: start.lines,
            ...(start.failure === null ? {} : { failure: start.failure }),
            ...(start.join === null ? {} : { join: start.join })
        };

        return { id: start.id, folder: start.folder, candidate, workspaceFolder: start.workspaceFolder, machineId: start.machineId };
    }
}

function accountOf(accountId: string): string {
    if (!ACCOUNT_ID.test(accountId)) {
        throw new DevcontainerStartError('Sign in to your account first: the new machine joins the account you are signed in to.');
    }

    return accountId;
}
