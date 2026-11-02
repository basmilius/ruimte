import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import {
    dueTimesBetween,
    nextDue,
    ROUTINE_LIMITS,
    type AgentRoutine,
    type ArtifactProvenance,
    type ChatInfo,
    type Routine,
    type RoutineEntry,
    type RoutineGetResult,
    type RoutineListResult,
    type RoutineLocal,
    type RoutineMadeBy,
    type RoutineRun,
    type RoutineRunKind,
    type RoutineRunNowResult,
    type RoutineRunState,
    type RoutineSkip,
    type RuntimeMode
} from '@ruimte/contracts';
import { narrowerMode } from '@adecore/agents/providers';
import { isInside } from '../canvas/project-paths.ts';
import { PUBLISHED_INLINE_NOTE } from '../context/context-note.ts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, RoutineRunEntry } from '../outbox/outbox.ts';
import type { RoutineAuthorStore, RoutineRunStore } from './routine-runs.ts';
import { RoutineError, type RoutinesDocument, type RoutineStore, type StoredRoutine } from './routine-store.ts';

/* A run that comes this much after its time made up for a time the machine slept or was off through. */
const CATCH_UP_AFTER_MS = 5 * 60_000;

// How far back a list reads runs: the week a person looks at and the one before it.
const LISTED_RUNS_MS = 15 * 24 * 60 * 60_000;

const OUTPUT_CAP_BYTES = 4 * 1024 * 1024;

/* What starts the chat of an agent run; the daemon puts it in the project as a hidden agent of the routine and owes its start through the outbox. */
export interface AgentRunStart {
    projectId: string;
    folder: string;
    chatId: string;
    routine: AgentRoutine;
    account?: string;
    prompt: string;
    brief?: string;
}

/* The project folder a command runs in, and what it printed when it ended. */
export interface CommandResult {
    exitCode: number;
    output: Uint8Array;
}

interface RoutineDeps {
    store: Pick<RoutineStore, 'read' | 'fresh' | 'put' | 'setLocal' | 'remove'>;
    runs: RoutineRunStore;
    authors: RoutineAuthorStore;
    approvals: { has(folder: string, key: string, digest: string): boolean; approve(folder: string, key: string, digest: string): Promise<void> };
    /* Every project in the machine's register, open or not. */
    projects(): Promise<Array<{ projectId: string; name: string; folder: string }>>;
    outbox: {
        enqueue(projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void>;
        list(): OutboxEntry[];
        remove(id: string): Promise<void>;
    };
    agents: {
        start(start: AgentRunStart): Promise<void>;
        info(chatId: string): ChatInfo | undefined;
        /* Whether a start of this chat is still owed. */
        starting(chatId: string): boolean;
        /* Opens a turn in a chat a person already has; false while it is in one, or gone. */
        continueIn(chatId: string, message: RunMessage, routine: AgentRoutine): Promise<boolean>;
        exists(chatId: string): Promise<boolean>;
    };
    commands: { run(cwd: string, command: string, capBytes: number): Promise<CommandResult> };
    launches?: {
        approved(projectId: string, launchId: string): Promise<boolean>;
        /* Starts a task as an agent would and resolves once it ended, with the text of its terminal. */
        run(projectId: string, launchId: string): Promise<{ outcome: 'started'; ended: Promise<CommandResult> } | { outcome: 'held' | 'busy' }>;
    };
    output: {
        latest(projectId: string, key: string): { artifactId: string; versionId: string; number: number } | null;
        /* The versions of a project's artifact under this key, by the run that made them. */
        byRun(projectId: string, key: string): Map<string, { artifactId: string; versionId: string; number: number }>;
        deliver(input: { projectId: string; key: string; title: string; requestId: string; provenance: ArtifactProvenance; text: Uint8Array }): Promise<void>;
    };
    machineId: string;
    now(): number;
    timeZone(): string;
    onChanged(projectId: string): void;
    log?: (line: string) => void;
}

function routineTarget(projectId: string, routineId: string): string {
    return `routine:${projectId}:${routineId}`;
}

/* The id a run's chat is opened by, which keeps it in the project without a canvas and outlives the routine. */
export function routineOpener(routineId: string): string {
    return `routine:${routineId}`;
}

/* Everything an approval covers, so a change to any of it asks again. Title and output key only label the run. */
export function digestOf(routine: Routine): string {
    const what =
        routine.kind === 'agent'
            ? // What was picked opens views to the run, so it asks again too; a routine without picks keeps its digest.
              [
                  'agent',
                  routine.prompt,
                  routine.provider,
                  routine.selection ?? null,
                  routine.mode,
                  routine.perRun,
                  ...(routine.picked === undefined ? [] : [routine.picked])
              ]
            : routine.kind === 'command'
              ? ['command', routine.command, routine.cwd ?? null]
              : routine.kind === 'launch'
                ? ['launch', routine.launchId]
                : ['unknown', routine];
    return createHash('sha256')
        .update(JSON.stringify([...what, routine.schedule, routine.outputKey]))
        .digest('hex')
        .slice(0, 32);
}

function approvalKey(routineId: string): string {
    return `routine:${routineId}`;
}

function runIdFor(target: string, due: number): string {
    return `run-${createHash('sha256')
        .update(JSON.stringify([target, due]))
        .digest('hex')
        .slice(0, 16)}`;
}

function freshId(prefix: string): string {
    return `${prefix}-${Array.from(randomBytes(8), (byte) => (byte % 36).toString(36)).join('')}`;
}

const LIVE: ReadonlySet<RoutineRunState> = new Set(['starting', 'running', 'needs-you', 'limit']);
const RESTARTED = 'The machine restarted during the run';

/* The state of an agent run as its chat says it now; idle before the run's turn ended is still the start. */
function chatState(info: ChatInfo, run: Pick<RoutineRun, 'state' | 'turnsBefore'>): { state: RoutineRunState; limitUntil?: number; error?: string } {
    if (info.status === 'needs-you') {
        return { state: 'needs-you' };
    }
    if (info.status === 'running' || info.delegating === true || (info.background?.length ?? 0) > 0) {
        return { state: 'running' };
    }
    if (info.limit !== undefined) {
        return info.resumeAt === undefined
            ? { state: 'failed', error: info.limit.kind === 'usage' ? 'Stopped on a usage limit' : 'The provider was overloaded' }
            : { state: 'limit', limitUntil: info.resumeAt };
    }
    if (info.status === 'error' || info.status === 'exited') {
        return { state: 'failed', error: 'The agent stopped with an error' };
    }
    if (info.usage.turns <= (run.turnsBefore ?? 0)) {
        return { state: run.state === 'needs-you' ? 'running' : run.state };
    }
    return { state: 'done' };
}

function formatDue(at: number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(at);
}

/* What a run of an agent routine says: the person's prompt as the message, and Ruimte's brief heard beside it. */
export interface RunMessage {
    prompt: string;
    brief?: string;
}

/*
 * Ruimte's instructions to a run of an agent routine: where a result goes when it has one. A routine's
 * result is a version of one artifact, never loose files in the project.
 */
function runBrief(
    routine: AgentRoutine,
    when: string,
    previous: { artifactId: string; versionId: string; number: number } | null,
    kind: RoutineRunKind
): string {
    const lines = [
        `This is a run of the routine "${routine.title}", which Ruimte started ${kind === 'manual' ? 'by hand' : kind === 'caught-up' ? `late, after this machine woke (it was due ${when})` : `at ${when}`}.`,
        `When this run has a result to keep, such as a report, deliver it to Output and never as files in the project: write it to a file outside the project folder, such as a Markdown report in a temporary folder, and publish it with \`artifact_publish --key ${routine.outputKey} --title ${JSON.stringify(routine.title)} --file <path>\`. Every run that publishes adds one version of that artifact. A run with nothing to keep publishes nothing.`,
        PUBLISHED_INLINE_NOTE
    ];
    if (previous !== null) {
        lines.push(
            `The previous run delivered version ${previous.number}. Read it with \`artifact_read ${previous.artifactId} --version ${previous.versionId}\` and use it as context, for example to say what changed since.`
        );
    }
    return lines.join('\n');
}

/*
 * The brief goes beside the prompt, except after a slash command: a CLI hears nothing in front of one,
 * so it rides in the message as the command's arguments.
 */
export function runMessage(prompt: string, brief: string): RunMessage {
    return prompt.startsWith('/') ? { prompt: `${prompt}\n\n---\n${brief}` } : { prompt, brief };
}

/*
 * Routines on this machine: when each is due, the `routine-run` entry that owes it, what a run starts
 * and what it delivered. A routine runs only as a person on this machine approved it as it stands now,
 * whether or not a client has its project open.
 */
export class Routines {
    private readonly deps: RoutineDeps;
    private readonly log: (line: string) => void;
    // Command and launch runs this daemon started, which end with it, and what each owes once it ends.
    private readonly live = new Set<string>();
    private readonly ending = new Set<Promise<void>>();

    constructor(deps: RoutineDeps) {
        this.deps = deps;
        this.log = deps.log ?? ((line) => console.error(line));
    }

    /*
     * Once at boot, before the outbox works: owes the next time of every routine that has none, and ends
     * the command runs the last daemon took down with it. An entry the last daemon left due in the past
     * stays, so it runs once now as a run that caught up.
     */
    async start(): Promise<void> {
        for (const run of this.deps.runs.all()) {
            if (!LIVE.has(run.state)) {
                continue;
            }
            if (run.chatId === undefined) {
                await this.deps.runs.put({ ...run, state: 'failed', endedAt: this.deps.now(), error: RESTARTED });
            } else {
                await this.settleAfterRestart(run, run.chatId);
            }
        }
        for (const project of await this.deps.projects()) {
            await this.schedule(project.projectId).catch((e: unknown) => this.log(`Scheduling the routines of ${project.folder} failed: ${errorText(e)}`));
        }
    }

    /*
     * An agent run the last daemon noted as live: its chat says how it ended, since no observer heard it
     * after the restart. One its chat never began, with no start still owed, would stay busy forever.
     */
    private async settleAfterRestart(run: RoutineRun, chatId: string): Promise<void> {
        if (this.deps.agents.starting(chatId)) {
            return;
        }
        const info = (await this.deps.agents.exists(chatId).catch(() => false)) ? this.deps.agents.info(chatId) : undefined;
        const now = info === undefined ? null : chatState(info, run);
        if (now !== null && LIVE.has(now.state) && now.state !== 'starting') {
            return;
        }
        const ended = now === null || now.state === 'starting' ? { state: 'failed' as const, error: RESTARTED } : now;
        await this.deps.runs.put({ ...run, ...ended, endedAt: this.deps.now() });
    }

    async list(projectId?: string): Promise<RoutineListResult> {
        const projects = (await this.deps.projects()).filter((project) => projectId === undefined || project.projectId === projectId);
        if (projectId !== undefined && projects.length === 0) {
            throw new RoutineError('project-not-found', `No project ${projectId} on this machine`);
        }
        const routines: RoutineEntry[] = [];
        const revs: Record<string, number> = {};
        const since = this.deps.now() - LISTED_RUNS_MS;
        for (const project of projects) {
            let document: RoutinesDocument;
            try {
                document = await this.deps.store.read(project.projectId);
            } catch (e) {
                // One project whose files cannot be read leaves the others listed.
                this.log(`Reading the routines of ${project.folder} failed: ${errorText(e)}`);
                continue;
            }
            revs[project.projectId] = document.rev;
            for (const stored of document.routines) {
                routines.push(this.entryOf(project.projectId, project.name, document.folder, stored, since));
            }
        }
        return { routines, revs, timeZone: this.deps.timeZone() };
    }

    async get(projectId: string, routineId: string): Promise<RoutineGetResult> {
        const project = await this.projectOf(projectId);
        const document = await this.deps.store.read(projectId);
        const stored = this.find(document, routineId);
        return { routine: this.entryOf(projectId, project.name, document.folder, stored, 0), rev: document.rev, timeZone: this.deps.timeZone() };
    }

    /* A person's save: what it sets is approved on this machine as it stands, the way a save that sets a terminal's command is. */
    async save(projectId: string, baseRev: number, routine: Routine, shared: boolean, account?: string | null): Promise<{ rev: number; routineId: string }> {
        await this.projectOf(projectId);
        this.check(routine);
        const local: Partial<RoutineLocal> = account === undefined ? {} : { account: account ?? undefined };
        const document = await this.deps.store.put(projectId, baseRev, routine, shared, local);
        await this.deps.approvals.approve(document.folder, approvalKey(routine.id), digestOf(routine));
        await this.changed(projectId);
        return { rev: document.rev, routineId: routine.id };
    }

    /*
     * An agent's save, through a verb: never an approval, and never a mode wider than the agent's own.
     * The chat that made it is written down here, so the person who approves it sees where it came from.
     */
    async saveByAgent(
        projectId: string,
        routine: Routine,
        ceiling: RuntimeMode,
        madeBy: RoutineMadeBy,
        shared = false
    ): Promise<{ routine: Routine; rev: number; shared: boolean }> {
        const bounded = routine.kind === 'agent' ? { ...routine, mode: narrowerMode(routine.mode, ceiling) } : routine;
        this.check(bounded);
        const before = await this.deps.store.fresh(projectId);
        const existing = before.routines.find((candidate) => candidate.routine.id === routine.id);
        const placed = existing?.shared ?? shared;
        const document = await this.deps.store.put(projectId, before.rev, bounded, placed);
        await this.deps.authors.put(projectId, bounded.id, digestOf(bounded), madeBy);
        await this.changed(projectId);
        return { routine: bounded, rev: document.rev, shared: placed };
    }

    async approve(projectId: string, routineId: string, digest: string): Promise<void> {
        const document = await this.deps.store.fresh(projectId);
        const stored = this.find(document, routineId);
        if (digestOf(stored.routine) !== digest) {
            throw new RoutineError('digest-stale', 'This routine changed since it was shown; look at it again before you approve it');
        }
        await this.deps.approvals.approve(document.folder, approvalKey(routineId), digest);
        if (stored.local.declined !== undefined) {
            await this.deps.store.setLocal(projectId, routineId, { declined: undefined });
        }
        await this.changed(projectId);
    }

    /* A person's no to a routine as it stands: it does not run here and leaves the approvals until it changes. */
    async decline(projectId: string, routineId: string, digest: string): Promise<void> {
        await this.deps.store.setLocal(projectId, routineId, { declined: digest });
        await this.changed(projectId);
    }

    async pause(projectId: string, routineId: string): Promise<void> {
        await this.deps.store.setLocal(projectId, routineId, { pausedAt: this.deps.now() });
        await this.changed(projectId);
    }

    /* Owes the next time from now, never the times it was paused through. */
    async resume(projectId: string, routineId: string): Promise<void> {
        await this.deps.store.setLocal(projectId, routineId, { pausedAt: undefined });
        await this.changed(projectId);
    }

    /* Removes the routine and what it is owed; its runs, their chats and its artifact stay. */
    async remove(projectId: string, baseRev: number, routineId: string): Promise<void> {
        await this.deps.store.remove(projectId, baseRev, routineId);
        await this.changed(projectId);
    }

    /* A run now, by a person or an agent; only one approved as it stands, and never beside a run that is still going. */
    async runNow(projectId: string, routineId: string): Promise<RoutineRunNowResult> {
        const project = await this.projectOf(projectId);
        const document = await this.deps.store.fresh(projectId);
        const stored = this.find(document, routineId);
        if (!this.approved(document.folder, stored)) {
            return { outcome: 'held' };
        }
        if (this.busy(projectId, routineId)) {
            return { outcome: 'busy' };
        }
        const now = this.deps.now();
        const run = await this.begin(project, document.folder, stored, { runId: freshId('run'), kind: 'manual', due: now });
        return { outcome: 'started', runId: run.runId };
    }

    /* The handler of a `routine-run` entry: the routine as it stands on disk now decides what happens. */
    async handle(entry: RoutineRunEntry): Promise<void> {
        const { routineId, due } = entry.payload;
        const projects = await this.deps.projects();
        const project = projects.find((candidate) => candidate.projectId === entry.projectId);
        if (project === undefined) {
            return;
        }
        let document: RoutinesDocument;
        try {
            document = await this.deps.store.fresh(entry.projectId);
        } catch (e) {
            this.log(`Reading the routines of ${project.folder} failed: ${errorText(e)}`);
            return;
        }
        const stored = document.routines.find((candidate) => candidate.routine.id === routineId);
        if (stored === undefined || stored.local.pausedAt !== undefined) {
            return;
        }
        const runId = runIdFor(entry.target, due);
        // A restart between the run and the removal of its entry handles it again.
        if (this.deps.runs.get(runId) !== undefined) {
            await this.owe(entry.projectId, document.folder, stored, entry.id);
            return;
        }
        const now = this.deps.now();
        const late = now - due > CATCH_UP_AFTER_MS;
        const missed = late ? [due, ...dueTimesBetween(stored.routine.schedule, due, now, this.deps.timeZone(), 20)] : [];
        const kind: RoutineRunKind = late ? 'caught-up' : 'scheduled';
        const skip: RoutineSkip | null = !this.approved(document.folder, stored) ? 'held' : this.busy(entry.projectId, routineId) ? 'overlap' : null;
        if (skip !== null) {
            await this.deps.runs.put({
                runId,
                routineId,
                projectId: entry.projectId,
                kind,
                due,
                at: now,
                ...(missed.length > 0 ? { missed } : {}),
                state: 'skipped',
                skipped: skip
            });
        } else {
            await this.begin(project, document.folder, stored, { runId, kind, due, ...(missed.length > 0 ? { missed } : {}) });
        }
        await this.owe(entry.projectId, document.folder, stored, entry.id);
        this.deps.onChanged(entry.projectId);
    }

    /* Resolves once every command or launch run that ended has delivered and been written down. */
    async settled(): Promise<void> {
        while (this.ending.size > 0) {
            await Promise.all(this.ending);
        }
    }

    /* Notes what an agent run's chat does now: a wait on a person, its end, a limit. An observer only notes. */
    async observe(chatId: string, info: ChatInfo): Promise<void> {
        const run = this.deps.runs.ofChat(chatId);
        if (run === undefined || !LIVE.has(run.state)) {
            return;
        }
        const now = chatState(info, run);
        const waited = run.waited === true || now.state === 'needs-you';
        if (now.state === run.state && waited === (run.waited === true) && now.limitUntil === run.limitUntil) {
            return;
        }
        const ended = now.state === 'done' || now.state === 'failed';
        await this.deps.runs.put({
            ...run,
            state: now.state,
            ...(waited ? { waited } : {}),
            ...(now.limitUntil === undefined ? {} : { limitUntil: now.limitUntil }),
            ...(ended ? { endedAt: this.deps.now() } : {}),
            ...(now.error === undefined ? {} : { error: now.error })
        });
        this.deps.onChanged(run.projectId);
    }

    /* What a version published from a run's chat records of the routine; nothing for any other chat. */
    provenanceOf(chatId: string): Pick<ArtifactProvenance, 'routineId' | 'runId'> | null {
        const run = this.deps.runs.ofChat(chatId);
        return run === undefined ? null : { routineId: run.routineId, runId: run.runId };
    }

    /* Owes the next time of every routine of a project that runs here, and drops what is owed for one that no longer does. */
    async schedule(projectId: string): Promise<void> {
        const document = await this.deps.store.fresh(projectId);
        const owed = this.deps.outbox.list().filter((entry) => entry.kind === 'routine-run' && entry.projectId === projectId);
        const known = new Set(document.routines.map((stored) => routineTarget(projectId, stored.routine.id)));
        for (const entry of owed) {
            if (!known.has(entry.target)) {
                await this.deps.outbox.remove(entry.id);
            }
        }
        for (const stored of document.routines) {
            await this.owe(projectId, document.folder, stored);
        }
    }

    private async changed(projectId: string): Promise<void> {
        await this.schedule(projectId);
        this.deps.onChanged(projectId);
    }

    /* Puts the one entry a routine is owed in place: none while it does not run here, its next time otherwise. `handled` is the entry that runs now, which the worker removes. */
    private async owe(projectId: string, folder: string, stored: StoredRoutine, handled?: string): Promise<void> {
        const target = routineTarget(projectId, stored.routine.id);
        const now = this.deps.now();
        const owed = this.deps.outbox.list().filter((entry) => entry.kind === 'routine-run' && entry.target === target && entry.id !== handled);
        const next = this.nextOf(folder, stored, now);
        // A time that passed while the machine was off or asleep is still owed, so it runs once now.
        const pending = owed.find((entry) => entry.kind === 'routine-run' && entry.payload.due <= now);
        if (pending !== undefined && next !== null) {
            for (const entry of owed) {
                if (entry !== pending) {
                    await this.deps.outbox.remove(entry.id);
                }
            }
            return;
        }
        if (owed.length === 1 && owed[0]!.kind === 'routine-run' && owed[0]!.payload.due === next) {
            return;
        }
        for (const entry of owed) {
            await this.deps.outbox.remove(entry.id);
        }
        if (next !== null) {
            await this.deps.outbox.enqueue(projectId, target, { kind: 'routine-run', payload: { routineId: stored.routine.id, due: next } }, next);
        }
    }

    private nextOf(folder: string, stored: StoredRoutine, now: number): number | null {
        if (!this.runsHere(folder, stored)) {
            return null;
        }
        return nextDue(stored.routine.schedule, now, this.deps.timeZone());
    }

    private runsHere(folder: string, stored: StoredRoutine): boolean {
        return this.approved(folder, stored) && stored.local.pausedAt === undefined;
    }

    private approved(folder: string, stored: StoredRoutine): boolean {
        return this.deps.approvals.has(folder, approvalKey(stored.routine.id), digestOf(stored.routine));
    }

    /* Whether the newest run that started still runs or waits on a person. */
    private busy(projectId: string, routineId: string): boolean {
        const latest = this.deps.runs.of(projectId, routineId).find((run) => run.state !== 'skipped');
        return latest !== undefined && LIVE.has(this.liveState(latest).state);
    }

    private liveState(run: RoutineRun): Pick<RoutineRun, 'state' | 'limitUntil' | 'error'> {
        if (!LIVE.has(run.state)) {
            return run;
        }
        if (run.chatId === undefined) {
            return this.live.has(run.runId) ? run : { state: 'failed', error: RESTARTED };
        }
        const info = this.deps.agents.info(run.chatId);
        if (info === undefined) {
            return this.deps.agents.starting(run.chatId) ? { state: 'starting' } : run;
        }
        // In one chat that runs on, only the newest run is the one the chat is doing now.
        if (this.deps.runs.ofChat(run.chatId)?.runId !== run.runId) {
            return run;
        }
        return chatState(info, run);
    }

    private async begin(
        project: { projectId: string; name: string },
        folder: string,
        stored: StoredRoutine,
        start: { runId: string; kind: RoutineRunKind; due: number; missed?: number[] }
    ): Promise<RoutineRun> {
        const { routine } = stored;
        const base: RoutineRun = { ...start, routineId: routine.id, projectId: project.projectId, at: this.deps.now(), state: 'starting' };
        try {
            if (routine.kind === 'agent') {
                return await this.beginAgent(project.projectId, folder, stored, routine, base);
            }
            if (routine.kind === 'command') {
                const cwd = resolve(folder, routine.cwd ?? '.');
                if (isAbsolute(routine.cwd ?? '.') || !isInside(folder, cwd)) {
                    throw new RoutineError('routines-invalid', 'The folder of this command is outside the project');
                }
                return await this.beginCommand(base, routine.title, routine.outputKey, () => this.deps.commands.run(cwd, routine.command, OUTPUT_CAP_BYTES));
            }
            if (routine.kind === 'launch') {
                const launches = this.deps.launches;
                if (launches === undefined || !(await launches.approved(project.projectId, routine.launchId))) {
                    const run: RoutineRun = { ...base, state: 'skipped', skipped: 'held' };
                    await this.deps.runs.put(run);
                    return run;
                }
                const started = await launches.run(project.projectId, routine.launchId);
                if (started.outcome !== 'started') {
                    const run: RoutineRun = { ...base, state: 'skipped', skipped: started.outcome === 'busy' ? 'overlap' : 'held' };
                    await this.deps.runs.put(run);
                    return run;
                }
                return await this.beginCommand(base, routine.title, routine.outputKey, () => started.ended);
            }
            throw new RoutineError('routines-invalid', 'This machine does not know what this routine runs');
        } catch (e) {
            const run: RoutineRun = { ...base, state: 'failed', endedAt: this.deps.now(), error: errorText(e) };
            await this.deps.runs.put(run);
            return run;
        }
    }

    private async beginAgent(projectId: string, folder: string, stored: StoredRoutine, routine: AgentRoutine, base: RoutineRun): Promise<RoutineRun> {
        const previous = this.deps.output.latest(projectId, routine.outputKey);
        const message = runMessage(routine.prompt, runBrief(routine, formatDue(base.due, this.deps.timeZone()), previous, base.kind));
        if (routine.perRun === 'continue') {
            const last = this.deps.runs.of(projectId, routine.id).find((run) => run.chatId !== undefined);
            if (last?.chatId !== undefined && (await this.deps.agents.exists(last.chatId))) {
                const run: RoutineRun = { ...base, chatId: last.chatId, state: 'running', turnsBefore: this.deps.agents.info(last.chatId)?.usage.turns ?? 0 };
                await this.deps.runs.put(run);
                if (!(await this.deps.agents.continueIn(last.chatId, message, routine))) {
                    const skipped: RoutineRun = { ...base, state: 'skipped', skipped: 'overlap' };
                    await this.deps.runs.put(skipped);
                    return skipped;
                }
                return run;
            }
        }
        const chatId = freshId('chat');
        const run: RoutineRun = { ...base, chatId };
        // On disk before the start is owed, so the chat that opens finds the run it belongs to.
        await this.deps.runs.put(run);
        await this.deps.agents.start({
            projectId,
            folder,
            chatId,
            routine,
            ...(stored.local.account === undefined ? {} : { account: stored.local.account }),
            ...message
        });
        return run;
    }

    private async beginCommand(base: RoutineRun, title: string, outputKey: string, start: () => Promise<CommandResult>): Promise<RoutineRun> {
        const run: RoutineRun = { ...base, state: 'running' };
        await this.deps.runs.put(run);
        this.live.add(run.runId);
        const ending = start()
            .then(async (result) => {
                await this.deps.output
                    .deliver({
                        projectId: run.projectId,
                        key: outputKey,
                        title,
                        requestId: run.runId,
                        provenance: { maker: 'routine', machineId: this.deps.machineId, routineId: run.routineId, runId: run.runId },
                        text: result.output
                    })
                    .catch((e: unknown) => this.log(`Delivering the output of a routine run failed: ${errorText(e)}`));
                await this.deps.runs.put({
                    ...run,
                    state: result.exitCode === 0 ? 'done' : 'failed',
                    exitCode: result.exitCode,
                    endedAt: this.deps.now(),
                    ...(result.exitCode === 0 ? {} : { error: `Exited with code ${result.exitCode}` })
                });
            })
            .catch(async (e: unknown) => {
                await this.deps.runs.put({ ...run, state: 'failed', endedAt: this.deps.now(), error: errorText(e) });
            })
            .finally(() => {
                this.live.delete(run.runId);
                this.ending.delete(ending);
                this.deps.onChanged(run.projectId);
            });
        this.ending.add(ending);
        return run;
    }

    private entryOf(projectId: string, projectName: string, folder: string, stored: StoredRoutine, since: number): RoutineEntry {
        const { routine, shared, local } = stored;
        const digest = digestOf(routine);
        const approved = this.approved(folder, stored);
        const madeBy = approved ? undefined : this.deps.authors.of(projectId, routine.id, digest);
        const versions = this.deps.output.byRun(projectId, routine.outputKey);
        const runs = this.deps.runs
            .of(projectId, routine.id)
            .filter((run) => run.at >= since || LIVE.has(run.state))
            .slice(0, ROUTINE_LIMITS.runsListed)
            .map((run) => {
                const version = versions.get(run.runId);
                return {
                    ...run,
                    ...this.liveState(run),
                    ...(version === undefined ? {} : { artifactId: version.artifactId, versionId: version.versionId, versionNumber: version.number })
                };
            });
        const latest = this.deps.output.latest(projectId, routine.outputKey);
        const declined = local.declined === digest;
        return {
            routine,
            projectId,
            projectName,
            shared,
            local,
            digest,
            approved,
            ...(approved || declined ? {} : { held: madeBy === undefined ? ('outside' as const) : ('agent' as const) }),
            ...(madeBy === undefined ? {} : { madeBy }),
            next: this.nextOf(folder, stored, this.deps.now()),
            runs,
            ...(latest === null ? {} : { artifactId: latest.artifactId })
        };
    }

    private check(routine: Routine): void {
        if (routine.kind === 'command' && routine.cwd !== undefined && isAbsolute(routine.cwd)) {
            throw new RoutineError('routines-invalid', 'The folder of a command is relative to the project');
        }
    }

    private find(document: RoutinesDocument, routineId: string): StoredRoutine {
        const stored = document.routines.find((candidate) => candidate.routine.id === routineId);
        if (stored === undefined) {
            throw new RoutineError('routine-not-found', `This project has no routine ${routineId}`);
        }
        return stored;
    }

    private async projectOf(projectId: string): Promise<{ projectId: string; name: string; folder: string }> {
        const project = (await this.deps.projects()).find((candidate) => candidate.projectId === projectId);
        if (project === undefined) {
            throw new RoutineError('project-not-found', `No project ${projectId} on this machine`);
        }
        return project;
    }
}
