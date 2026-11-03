import { BYTES_CHUNK_MAX, type PeerResultResult, type PeerTaskStartPayload, type PeerTaskStartResult } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import type { TaskCoordinator, TaskStore } from '@adecore/agents/coordination';
import { MAX_RESULT_LENGTH } from '../tools/tasks.ts';
import { BundleStore, bundleIdFor, fetchBundle, makeBundle } from '../git/bundles.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { Worktrees } from '../git/worktrees.ts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, StartRemoteAgentEntry, StopRemoteAgentEntry, TakeRemoteResultEntry } from '../outbox/outbox.ts';
import { RECONNECT_LIFETIME_MS, peerTarget } from './connect-peer.ts';
import type { PeerLink } from './peer-connection.ts';
import type { RemoteConnections } from './remote-connections.ts';

// The words of a refusal that are kept, since the machine that refused chose them.
const MAX_REFUSAL_LENGTH = 500;

// Said where a result is cut to the length every task result has.
const CLIPPED = '\n[The rest of the result was left out.]';

// A refusal that is a place not free yet: the entry waits for the machine to say a task settled, or for the link to open again.
const WAITS: ReadonlySet<string> = new Set(['peer-busy', 'peer-bundle-limit']);

export interface RemoteTasksDeps {
    connections: Pick<RemoteConnections, 'link'>;
    /* Owes a reconnect to a machine whose link is down while work waits on it. */
    reconnect: { owe(machineId: string): Promise<void> };
    /* Tells the clients again which tasks wait for the machine; `except` is an entry that is done. */
    refresh?: (machineId: string, except?: string) => void;
    tasks: Pick<TaskStore, 'get' | 'all'>;
    coordinator: Pick<TaskCoordinator, 'settleFromElsewhere'>;
    /* Whether a project still places the node. */
    placed(nodeId: string): boolean;
    /* The git of this machine, asked for when a checkout is sent: it is wired after the outbox. */
    git(): { bundles: BundleStore; checkpoints: Pick<CheckpointService, 'take' | 'head'>; worktrees: Pick<Worktrees, 'addFresh' | 'claim'> };
    /* The folder of a project and what a project calls the machine it is linked to, for the branch that comes back. */
    folderOf(projectId: string): string | null;
    labelOf(projectId: string, machineId: string): string;
    /* Writes down the folder of work that came back as one this machine never vouched for, before git makes it. */
    untrustFolder(path: string, branch: string): Promise<void>;
    outbox: { list(): readonly OutboxEntry[]; remove(id: string): Promise<void>; update(entry: OutboxEntry): Promise<void> };
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    /* Looks again at whatever waits on this target. */
    wake(target: string): void;
    now(): number;
    log?: (line: string) => void;
}

/*
 * What the reply of a machine that refused looks like: the code and the words it gave. A channel that
 * broke has no code, and neither has anything else that is not that machine's answer.
 */
function refusal(error: unknown): { code: string; message: string } | null {
    // The checkout could not be written as a bundle here (a repository that is not one, a bundle too large): that is an answer too.
    if (error instanceof CodedError) {
        return { code: error.code, message: error.message.slice(0, MAX_REFUSAL_LENGTH) };
    }
    const match = /^([a-z][a-z0-9-]*): (.*)$/s.exec(error instanceof Error ? error.message : '');
    return match === null || match[1] === 'internal' ? null : { code: match[1]!, message: match[2]!.slice(0, MAX_REFUSAL_LENGTH) };
}

function base64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

/*
 * The tasks this machine gives agents on another machine, owed through the outbox: the start waits for
 * the link and for nothing else, and a stop of an agent that started is owed until the machine heard it.
 * Nothing here runs on a clock; the reconnect (`connect-peer.ts`) is the only thing that tries again.
 */
export class RemoteTasks {
    private readonly deps: RemoteTasksDeps;
    /* How often this machine left its account: work in flight from before a leave owes nothing once it resumes. */
    private leaves = 0;

    constructor(deps: RemoteTasksDeps) {
        this.deps = deps;
    }

    /* Sends the checkout when there is one and asks the machine to start the task. */
    readonly start = async (entry: StartRemoteAgentEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const era = this.leaves;
        const task = deps.tasks.get(taskId);
        // Stopped or removed before it started: nothing was asked of the machine, so nothing is owed to it.
        if (task === undefined || task.status !== 'open' || !deps.placed(entry.target)) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            return await this.waitForLink(machineId);
        }
        let bundleId: string | null = null;
        try {
            const bundle = entry.payload.source === undefined ? undefined : await this.send(link, entry, task.title);
            bundleId = bundle?.bundleId ?? null;
            const request: PeerTaskStartPayload = {
                projectId: entry.payload.remoteProjectId,
                nodeId: entry.target,
                parentId: entry.payload.parentId,
                title: task.title,
                prompt: task.prompt,
                provider: entry.payload.provider,
                terminal: entry.payload.node === 'terminal',
                ...(entry.payload.mode === undefined ? {} : { mode: entry.payload.mode }),
                ceiling: entry.payload.ceiling,
                depth: entry.payload.depth,
                ...(bundle === undefined ? {} : { bundle: { bundleId: bundle.bundleId, sha256: bundle.sha256 } }),
                ...(entry.payload.branch === undefined ? {} : { branch: entry.payload.branch })
            };
            await this.markSent(entry, true);
            // Stopped or removed while the checkout went over: the start is not asked at all.
            if (!this.owes(entry.id)) {
                return undefined;
            }
            const started = await link.request<PeerTaskStartResult>('peer.taskStart', request);
            await this.started(entry, started, era);
        } catch (e) {
            if (this.leaves !== era) {
                return undefined;
            }
            // The link went while the request was out; the reconnect owes it again and this runs once it is back.
            if (deps.connections.link(machineId) === null) {
                // Dropped meanwhile by a stop that may have come before the start was marked as sent.
                if (entry.payload.sent === true && !this.owes(entry.id)) {
                    await this.oweStopTo(entry.projectId, machineId, entry.target);
                    return undefined;
                }
                return await this.waitForLink(machineId);
            }
            const refused = refusal(e);
            if (refused === null) {
                throw e;
            }
            if (WAITS.has(refused.code)) {
                // The machine has no place for it yet; it says when a task settled, and a link that opens again runs this too.
                await this.markSent(entry, false);
                deps.refresh?.(machineId);
                return 'wait';
            }
            await this.fail(taskId, `The task could not be started on the other machine: ${refused.message}`);
        } finally {
            if (bundleId !== null) {
                await deps
                    .git()
                    .bundles.discard(bundleId)
                    .catch(() => undefined);
            }
        }
        deps.refresh?.(machineId, entry.id);
        // A checkout sent and taken in leaves room for the next one that waited for it.
        if (entry.payload.source !== undefined) {
            this.wakeStarts(machineId, entry.target);
        }
        return undefined;
    };

    /*
     * A machine said a task of this one settled: its result is asked for, and the tasks that waited for a place
     * try again. A result nothing here waits for any more (settled before its node went, or never known) is
     * acknowledged, or that machine would keep it and tell of it at every link.
     */
    peerSettled(machineId: string, nodeId: string): void {
        const { deps } = this;
        const owed = deps.outbox
            .list()
            .some((entry) => entry.target === nodeId && (entry.kind === 'start-remote-agent' || entry.kind === 'take-remote-result'));
        const open = deps.tasks.all().some((task) => task.machine === machineId && task.childId === nodeId && task.status === 'open');
        if (!owed && !open) {
            deps.connections
                .link(machineId)
                ?.request('peer.result', { nodeId, ack: true })
                .catch((e: unknown) => deps.log?.(`The other machine did not take the acknowledgment for ${nodeId}: ${errorText(e)}`));
            return;
        }
        // The machine names the node, so a node it was never given a task for is none of its business.
        if (!deps.tasks.all().some((task) => task.machine === machineId && task.childId === nodeId)) {
            return;
        }
        deps.wake(nodeId);
        this.wakeStarts(machineId, nodeId);
    }

    /*
     * Writes down whether the machine may have the start, on the entry the worker holds too, since a failed
     * attempt is written back from that object. An entry that went meanwhile stays gone.
     */
    private async markSent(entry: StartRemoteAgentEntry, sent: boolean): Promise<void> {
        if (sent) {
            entry.payload.sent = true;
        } else {
            delete entry.payload.sent;
        }
        await this.deps.outbox.update(entry);
    }

    /* The link is down while work waits on it: a reconnect is owed, and this entry runs again once the link is back. */
    private async waitForLink(machineId: string): Promise<'wait'> {
        await this.deps.reconnect.owe(machineId);
        this.deps.refresh?.(machineId);

        return 'wait';
    }

    /* Fails the task with a line of its own, which wakes its parent once. */
    private fail(taskId: string, text: string): Promise<unknown> {
        return this.deps.coordinator.settleFromElsewhere(taskId, { text, source: 'exit', at: this.deps.now() }, 'failed');
    }

    private owes(entryId: string): boolean {
        return this.deps.outbox.list().some((entry) => entry.id === entryId);
    }

    /* Owes a stop until the machine heard it, unless one is owed already. */
    private async oweStopTo(projectId: string, machineId: string, nodeId: string): Promise<void> {
        if (this.deps.outbox.list().some((entry) => entry.kind === 'stop-remote-agent' && entry.payload.nodeId === nodeId && entry.payload.once !== true)) {
            return;
        }
        await this.deps.enqueue(projectId, peerTarget(machineId), { kind: 'stop-remote-agent', payload: { machineId, nodeId } });
    }

    private wakeStarts(machineId: string, except: string): void {
        for (const entry of this.deps.outbox.list()) {
            if (entry.kind === 'start-remote-agent' && entry.payload.machineId === machineId && entry.target !== except) {
                this.deps.wake(entry.target);
            }
        }
    }

    /* Writes the checkout as a bundle and sends it a piece at a time; a transfer that stops starts over, since offset 0 starts a bundle anew. */
    private async send(link: PeerLink, entry: StartRemoteAgentEntry, name: string): Promise<{ bundleId: string; sha256: string }> {
        const { bundles, checkpoints } = this.deps.git();
        // Under the id of the task, so a second try replaces the copy the machine still holds of the first.
        const made = await makeBundle(
            bundles,
            checkpoints,
            { path: entry.payload.source!, from: 'files', haves: [], name: name.slice(0, 120) },
            bundleIdFor(entry.payload.taskId)
        );
        const file = Bun.file(bundles.pathOf(made.bundleId));
        for (let offset = 0; offset < made.size; offset += BYTES_CHUNK_MAX) {
            const piece = new Uint8Array(await file.slice(offset, Math.min(offset + BYTES_CHUNK_MAX, made.size)).arrayBuffer());
            const { received } = await link.request<{ received: number }>('peer.bundlePut', {
                bundleId: made.bundleId,
                offset,
                data: base64(piece),
                total: made.size
            });
            if (received !== offset + piece.byteLength) {
                throw new Error('The other machine lost part of the transfer');
            }
        }
        return { bundleId: made.bundleId, sha256: made.sha256 };
    }

    /* The task runs there: its result is owed from now on, and a task stopped while it started is stopped there too. */
    private async started(entry: StartRemoteAgentEntry, started: PeerTaskStartResult, era: number): Promise<void> {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const base =
            entry.payload.source === undefined
                ? null
                : await deps
                      .git()
                      .checkpoints.head(entry.payload.source)
                      .catch(() => null);
        // Leaving the account failed the task and forgot the machine, so nothing more is owed to it.
        if (this.leaves !== era) {
            return;
        }
        const task = deps.tasks.get(taskId);
        if (task === undefined || task.status !== 'open' || !deps.placed(entry.target)) {
            await this.oweStopTo(entry.projectId, machineId, entry.target);
            return;
        }
        await deps.enqueue(entry.projectId, entry.target, {
            kind: 'take-remote-result',
            payload: { machineId, taskId, ...(base === null ? {} : { haves: [base] }) }
        });
        this.deps.log?.(`Task ${taskId} runs on ${machineId} in ${started.cwd ?? 'its project'}`);
    }

    /*
     * Asks the machine how the task stands, and once it settled takes the result in: the work comes back
     * as a branch here, the task settles from what the machine said (waking the parent once), and only
     * then does the machine hear that it has the result. A restart in between asks again and settles nothing twice.
     */
    readonly take = async (entry: TakeRemoteResultEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const era = this.leaves;
        const task = deps.tasks.get(taskId);
        if (task === undefined) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            return await this.waitForLink(machineId);
        }
        try {
            // Settled here before: only the machine's acknowledgment is left.
            if (task.status !== 'open') {
                await link.request('peer.result', { nodeId: entry.target, ack: true });
                this.wakeStarts(machineId, entry.target);
                return undefined;
            }
            const reported = await link.request<PeerResultResult>('peer.result', {
                nodeId: entry.target,
                ...(entry.payload.haves === undefined ? {} : { haves: entry.payload.haves })
            });
            if (this.leaves !== era) {
                return undefined;
            }
            if (reported.status === 'open') {
                return 'wait';
            }
            const text = await this.settle(link, entry, task.projectId, reported, era);
            if (this.leaves !== era) {
                return undefined;
            }
            // The link went while the work came back: the task stays open and the transfer starts over once it is back.
            if (text === null) {
                return await this.waitForLink(machineId);
            }
            await link.request('peer.result', { nodeId: entry.target, ack: true });
            // A task that ended there leaves a place for one that waited for it.
            this.wakeStarts(machineId, entry.target);
            deps.log?.(`Task ${taskId} on ${machineId} settled: ${text.slice(0, 80)}`);
        } catch (e) {
            if (this.leaves !== era) {
                return undefined;
            }
            if (deps.connections.link(machineId) === null) {
                return await this.waitForLink(machineId);
            }
            const refused = refusal(e);
            if (refused === null) {
                throw e;
            }
            await this.fail(
                taskId,
                refused.code === 'peer-not-linked'
                    ? 'The other machine no longer links this project to this one, so the task ended there.'
                    : `The other machine would not report on this task: ${refused.message}`
            );
        }
        return undefined;
    };

    /*
     * Settles the task from what the machine reported, with the branch it sent back named in the result.
     * Null leaves it open: the link went while the work came back, which a reconnect brings again.
     */
    private async settle(link: PeerLink, entry: TakeRemoteResultEntry, projectId: string, reported: PeerResultResult, era: number): Promise<string | null> {
        const { deps } = this;
        if (reported.status === 'unknown') {
            const text = 'The other machine has no record of this task, so it did not run there.';
            await this.fail(entry.payload.taskId, text);
            return text;
        }
        const base =
            reported.status === 'cancelled'
                ? {
                      text: `The task was stopped on the other machine${reported.result === null ? '' : `: ${reported.result.text}`}.`,
                      source: 'exit' as const,
                      at: reported.result?.at ?? deps.now()
                  }
                : (reported.result ?? { text: 'The other machine ended this task without a result.', source: 'exit' as const, at: deps.now() });
        let brought: string | null = null;
        if (reported.bundle !== null) {
            try {
                brought = await this.bringBack(link, entry, projectId, reported.bundle, era);
            } catch (e) {
                if (this.leaves !== era || deps.connections.link(entry.payload.machineId) !== link) {
                    return null;
                }
                // The machine refused the read, the bundle did not check out or git would not take it: asking again gives the same.
                brought = `The work could not be brought back: ${errorText(e)}`;
            }
        }
        // What the machine reported is its own word and as long as it likes; what is kept and woken with is bounded.
        const room = MAX_RESULT_LENGTH - (brought === null ? 0 : brought.length + 2);
        const shown = base.text.length > room ? `${base.text.slice(0, Math.max(0, room - CLIPPED.length))}${CLIPPED}` : base.text;
        const text = brought === null ? shown : `${shown}\n\n${brought}`;
        const status = reported.status === 'done' ? 'done' : 'failed';
        await deps.coordinator.settleFromElsewhere(entry.payload.taskId, { ...base, text }, status);
        return text;
    }

    /* Reads the bundle of the machine a piece at a time and takes it in as a remote branch with a worktree on it that the node owns. */
    private async bringBack(
        link: PeerLink,
        entry: TakeRemoteResultEntry,
        projectId: string,
        bundle: NonNullable<PeerResultResult['bundle']>,
        era: number
    ): Promise<string> {
        const { deps } = this;
        const folder = deps.folderOf(projectId);
        if (folder === null) {
            return 'The work stayed on the other machine: this project is not on this machine any more.';
        }
        const { bundles, worktrees } = deps.git();
        for (let offset = 0; offset < bundle.size;) {
            const piece = await link.request<{ size: number; data: string }>('peer.bundleRead', {
                bundleId: bundle.bundleId,
                offset,
                length: Math.min(BYTES_CHUNK_MAX, bundle.size - offset)
            });
            const bytes = Buffer.from(piece.data, 'base64');
            if (piece.size !== bundle.size || bytes.byteLength === 0) {
                throw new Error('The work changed while it was being sent');
            }
            await bundles.receive(bundle.bundleId, offset, bytes, bundle.size);
            offset += bytes.byteLength;
        }
        // Work of a machine this one no longer shares an account with is never taken into a repository.
        if (this.leaves !== era) {
            throw new Error('This machine left its account while the work came back');
        }
        const taken = await fetchBundle(
            bundles,
            worktrees as Worktrees,
            folder,
            {
                projectId,
                bundleId: bundle.bundleId,
                sha256: bundle.sha256,
                branch: bundle.branch,
                into: 'remote-ref',
                machine: deps.labelOf(projectId, entry.payload.machineId)
            },
            (path, branch) => deps.untrustFolder(path, branch)
        );
        if (taken.path !== undefined) {
            await worktrees.claim(folder, taken.path, entry.target).catch(() => undefined);
        }
        return `The work came back as the branch ${taken.branch}${taken.path === undefined ? '' : ` in the worktree ${taken.path}`}; worktree_merge ${taken.branch} brings it into your branch.`;
    }

    /*
     * The machine stayed out of reach for as long as the reconnect tries, or refused this one (`refusal` says
     * why). Each task given to it fails with a line that says so, which wakes its parent once, and an agent
     * that may already run there is owed a stop, asked once over a link that is open: a stop never starts a
     * window of its own.
     */
    async giveUp(machineId: string, refusal?: string): Promise<void> {
        const { deps } = this;
        const days = Math.round(RECONNECT_LIFETIME_MS / (24 * 60 * 60 * 1000));
        const why = refusal === undefined ? `could not be reached for ${days} days` : `refused this one (${refusal})`;
        const owed = deps.outbox
            .list()
            .filter(
                (entry): entry is StartRemoteAgentEntry | TakeRemoteResultEntry =>
                    (entry.kind === 'start-remote-agent' || entry.kind === 'take-remote-result') && entry.payload.machineId === machineId
            );
        for (const entry of owed) {
            await deps.outbox.remove(entry.id);
            const text =
                entry.kind === 'start-remote-agent'
                    ? `The other machine ${why}, so this task was never started there.`
                    : `The other machine ${why}, so what became of this task is not known. The agent there may still run until a person stops it on that machine.`;
            await this.fail(entry.payload.taskId, text);
            const stopOwed = deps.outbox.list().some((other) => other.kind === 'stop-remote-agent' && other.payload.nodeId === entry.target);
            // A start may have reached the machine without its answer reaching this one, so it too may have an agent to stop.
            if (!stopOwed) {
                const task = deps.tasks.get(entry.payload.taskId);
                await deps.enqueue(task?.projectId ?? entry.projectId, peerTarget(machineId), {
                    kind: 'stop-remote-agent',
                    payload: { machineId, nodeId: entry.target, once: true }
                });
            }
        }
        deps.refresh?.(machineId);
    }

    /* Tells the machine to end an agent of this one, until it heard. */
    readonly stop = async (entry: StopRemoteAgentEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, nodeId, once } = entry.payload;
        const era = this.leaves;
        // A stop that cannot reach its machine is given up on after as long as the reconnect tries.
        if (once !== true && deps.now() - entry.createdAt >= RECONNECT_LIFETIME_MS) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            if (once === true) {
                return undefined;
            }
            await deps.reconnect.owe(machineId);
            return 'wait';
        }
        try {
            await link.request('peer.taskStop', { nodeId });
            // The place it held is free.
            this.wakeStarts(machineId, nodeId);
        } catch (e) {
            if (this.leaves !== era) {
                return undefined;
            }
            if (deps.connections.link(machineId) === null) {
                if (once === true) {
                    return undefined;
                }
                await deps.reconnect.owe(machineId);
                return 'wait';
            }
            // A machine that answers with a refusal has nothing of this node to end, or will not; asking again changes neither.
            if (refusal(e) === null) {
                throw e;
            }
            deps.log?.(`The other machine would not stop ${nodeId}: ${errorText(e)}`);
        }
        return undefined;
    };

    /*
     * The agent behind a node is ended or its node is gone. What waited to start is dropped, and an agent
     * that already runs there is owed a stop, since this machine is the one that decides it ends.
     */
    async oweStop(nodeId: string): Promise<void> {
        const { deps } = this;
        const task = deps.tasks.all().findLast((candidate) => candidate.childId === nodeId && candidate.machine !== undefined);
        if (task?.machine === undefined) {
            return;
        }
        const own = deps.outbox
            .list()
            .filter((entry) => entry.target === nodeId && (entry.kind === 'start-remote-agent' || entry.kind === 'take-remote-result'));
        for (const entry of own) {
            await deps.outbox.remove(entry.id);
        }
        deps.refresh?.(task.machine);
        // A start that went out may have reached the machine without its answer reaching this one; one that never went has nothing there to end.
        const mayRun = own.some((entry) => entry.kind === 'take-remote-result' || (entry.kind === 'start-remote-agent' && entry.payload.sent === true));
        if (mayRun) {
            await this.oweStopTo(task.projectId, task.machine, nodeId);
        }
    }

    /*
     * The machine left its account and forgot the machines it knew, so none of them is reached again. Each
     * task given to one fails with a line that says so, which wakes its parent once, and what was owed to them goes.
     */
    async leave(): Promise<void> {
        const { deps } = this;
        this.leaves += 1;
        const machines = new Set<string>();
        for (const entry of deps.outbox.list()) {
            if (entry.kind !== 'start-remote-agent' && entry.kind !== 'take-remote-result' && entry.kind !== 'stop-remote-agent') {
                continue;
            }
            await deps.outbox.remove(entry.id);
            machines.add(entry.payload.machineId);
            if (entry.kind === 'stop-remote-agent') {
                continue;
            }
            const text =
                entry.kind === 'start-remote-agent' && entry.payload.sent !== true
                    ? 'This machine left its account before the task was started on the other machine, so it never ran there.'
                    : entry.kind === 'start-remote-agent'
                      ? 'This machine left its account while the other machine was asked to start the task, so whether it started there is not known. The agent there may still run until a person stops it on that machine.'
                      : 'This machine left its account, so what became of this task on the other machine is not known. The agent there may still run until a person stops it on that machine.';
            await this.fail(entry.payload.taskId, text);
        }
        for (const machineId of machines) {
            deps.refresh?.(machineId);
        }
    }
}
