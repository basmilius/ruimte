import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import type { Worktree, WorktreeMergeStrategy } from '@ruimte/contracts';
import { agentsEndedWith } from '@/agents/end-children';
import { nextActionId } from '@/shell/panels/use-git-actions';
import { phaseLabel } from '@/shell/panels/git-actions';
import {
    checkedOutBranch,
    defaultSubject,
    hasLooseWork,
    isOverwriteRefusal,
    MERGE_STRATEGIES,
    mergeContents,
    mergedDescription,
    mergeTitle,
    runMerges,
    targetCheckout,
    type MergeOutcome,
    type MergeRun
} from '@/shell/panels/worktree-merge';
import { nodesInWorktree } from '@/shell/panels/worktree-rows';
import { Segmented, Toggle } from '@/shell/settings/controls';
import { nodeWorking } from '@/state/agent-work';
import { useChats } from '@/state/chats';
import { useEndpointId, endpointKey } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useUi, type WorktreeMergeRequest } from '@/state/ui';
import { useProjectNodes, worktreeLists, type WorktreeNode } from '@/state/worktrees';
import type { Transport } from '@/transport/transport';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';

type Reading = { request: WorktreeMergeRequest; worktrees: Worktree[]; failure: string | null };

/*
 * The one question before worktrees are merged, for a single one from the git panel or a node's menu
 * and for all of a group's at once. It counts the work again when it opens, offers to commit what is
 * not committed under a message naming the node, remembers the strategy on this client, and says so
 * when an agent is still working in one: the button then stops it first.
 */
export function MergeWorktreeDialog() {
    const request = useUi((s) => s.worktreeMerge);
    const endpointId = useEndpointId();
    const transport = useTransport();
    const strategy = useSettings((s) => s.worktreeMergeStrategy);
    const nodes = useProjectNodes();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.byKey);
    const [reading, setReading] = useState<Reading | null>(null);
    const [draft, setDraft] = useState<{ request: WorktreeMergeRequest | null; commitFirst: boolean; subject: string | null; remove: boolean }>({
        request: null,
        commitFirst: true,
        subject: null,
        remove: true
    });
    const [ended, setEnded] = useState(0);

    // A new question starts from its own defaults in the render that shows it.
    if (draft.request !== request) {
        setDraft({ request, commitFirst: true, subject: null, remove: request?.remove ?? true });
    }

    useEffect(() => {
        if (request === null) {
            return;
        }
        let cancelled = false;
        transport
            .request('git.worktree-list', { repo: request.folder, inspect: true })
            .then((answer) => {
                if (cancelled) {
                    return;
                }
                const found = request.paths.map((path) => answer.worktrees.find((entry) => entry.path === path)).filter((entry) => entry !== undefined);
                const usable = found.filter((entry) => !entry.missing);
                setReading({ request, worktrees: usable, failure: usable.length === 0 ? 'There is no worktree left to merge.' : null });
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setReading({ request, worktrees: [], failure: error instanceof Error ? error.message : 'Could not read the worktrees.' });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, request]);

    const shown = reading !== null && reading.request === request ? reading : null;
    const worktrees = useMemo(() => shown?.worktrees ?? [], [shown]);
    const working = useMemo(
        () => worktrees.flatMap((worktree) => nodesInWorktree(nodes, worktree)).filter((node) => nodeWorking(node, sessions, chats, endpointId)),
        [worktrees, nodes, sessions, chats, endpointId]
    );
    const live = useMemo(
        () =>
            worktrees
                .flatMap((worktree) => nodesInWorktree(nodes, worktree))
                .filter((node) => nodeLive(node, sessions, chats, endpointId) || nodeWorking(node, sessions, chats, endpointId)),
        [worktrees, nodes, sessions, chats, endpointId]
    );
    const workingIds = working.map((node) => node.id).join('\u0000');

    useEffect(() => {
        if (workingIds === '') {
            return;
        }
        let cancelled = false;
        void agentsEndedWith(transport, workingIds.split('\u0000')).then((count) => {
            if (!cancelled) {
                setEnded(count);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [transport, workingIds]);

    const loose = worktrees.some(hasLooseWork);
    const single = worktrees.length === 1 ? worktrees[0] : undefined;
    const singleNode = single === undefined ? null : (nodesInWorktree(nodes, single)[0] ?? null);
    const subject = draft.subject ?? (single === undefined ? '' : defaultSubject(singleNode?.title ?? null, single.branch));
    // Stopping is needed for an agent in a turn, and for any agent still open in a worktree that goes afterwards.
    const stopAgent = working.length > 0 || (draft.remove && live.length > 0);
    const blocked =
        shown === null ||
        shown.failure !== null ||
        (loose && !draft.commitFirst) ||
        (loose && single !== undefined && draft.commitFirst && subject.trim() === '');

    const close = (): void => {
        setReading(null);
        useUi.getState().setWorktreeMerge(null);
    };

    const confirm = (): void => {
        if (request === null || blocked) {
            return;
        }
        const runs: MergeRun[] = worktrees.map((worktree) => {
            const node = nodesInWorktree(nodes, worktree)[0] ?? null;
            const message = single !== undefined ? subject.trim() : defaultSubject(node?.title ?? null, worktree.branch);
            return {
                worktree,
                payload: {
                    repo: request.folder,
                    path: worktree.path,
                    strategy,
                    subject: message,
                    ...(hasLooseWork(worktree) && draft.commitFirst ? { commitFirst: true } : {}),
                    ...(draft.remove ? { remove: true } : {}),
                    ...(stopAgent ? { stopAgent: true } : {})
                }
            };
        });
        close();
        void mergeWithToasts(transport, request.folder, runs, () => worktreeLists.reload(endpointId, request.folder));
    };

    const agentLine =
        working.length > 0
            ? `${working.map((node) => node.title || node.kind).join(', ')} ${working.length === 1 ? 'is' : 'are'} still working. Merging stops ${working.length === 1 ? 'it' : 'them'} first${ended > 0 ? `, and the ${ended === 1 ? 'agent' : `${ended} agents`} ${working.length === 1 ? 'it' : 'they'} opened` : ''}.`
            : draft.remove && live.length > 0
              ? `${live.map((node) => node.title || node.kind).join(', ')} ${live.length === 1 ? 'is' : 'are'} still open in it and ${live.length === 1 ? 'is' : 'are'} stopped before the worktree goes.`
              : null;

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[460px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{worktrees.length > 0 ? mergeTitle(worktrees) : 'Merge worktree'}</Dialog.Title>
                    <p className="mt-1 text-sm text-text-muted">
                        {shown === null ? 'Counting what is in it...' : (shown.failure ?? `It holds ${mergeContents(worktrees)}.`)}
                    </p>
                    {agentLine !== null && <p className="mt-2 text-sm text-status-warning">{agentLine}</p>}
                    {shown !== null && shown.failure === null && (
                        <>
                            {loose && (
                                <div className="mt-4 flex flex-col gap-1.5">
                                    <label className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-text">Commit the uncommitted files first</span>
                                        <Toggle
                                            label="Commit the uncommitted files first"
                                            checked={draft.commitFirst}
                                            onChange={(commitFirst) => setDraft({ ...draft, commitFirst })}
                                        />
                                    </label>
                                    {!draft.commitFirst && (
                                        <span className="text-xs text-text-faint">Without that commit the merge would leave half of the work behind.</span>
                                    )}
                                </div>
                            )}
                            {single !== undefined && ((loose && draft.commitFirst) || strategy === 'squash') && (
                                <label className="mt-3 flex flex-col gap-1.5">
                                    <span className={SECTION_LABEL}>Commit message</span>
                                    <input
                                        className="field font-mono"
                                        spellCheck={false}
                                        value={subject}
                                        onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                                    />
                                </label>
                            )}
                            <div className="mt-4 flex flex-col gap-1.5">
                                <span className={SECTION_LABEL}>Strategy</span>
                                <Segmented
                                    label="Strategy"
                                    value={strategy}
                                    options={MERGE_STRATEGIES.map((entry) => ({ id: entry.value, label: entry.label }))}
                                    onChange={(value: WorktreeMergeStrategy) => useSettings.getState().update({ worktreeMergeStrategy: value })}
                                />
                                <span className="text-xs text-text-faint">{MERGE_STRATEGIES.find((entry) => entry.value === strategy)?.line}</span>
                            </div>
                            <label className="mt-4 flex items-center justify-between gap-3">
                                <span className="text-sm text-text">
                                    {worktrees.length === 1
                                        ? 'Remove the worktree and its branch afterwards'
                                        : 'Remove each worktree and its branch afterwards'}
                                </span>
                                <Toggle label="Remove afterwards" checked={draft.remove} onChange={(remove) => setDraft({ ...draft, remove })} />
                            </label>
                        </>
                    )}
                    <div className="mt-5 flex items-center justify-end gap-2">
                        <Button onClick={close}>Cancel</Button>
                        <Button variant="primary" disabled={blocked} onClick={confirm}>
                            {stopAgent ? 'Stop and merge' : 'Merge'}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* A terminal whose shell still runs or a chat whose CLI is up, in a turn or not. */
const nodeLive = (
    node: WorktreeNode,
    sessions: ReturnType<typeof useSessions.getState>['byKey'],
    chats: ReturnType<typeof useChats.getState>['byKey'],
    endpointId: string
): boolean => {
    const key = endpointKey(endpointId, node.id);
    if (node.kind === 'terminal') {
        const session = sessions[key];
        return session !== undefined && session.exited === undefined;
    }
    return node.kind === 'chat' && chats[key]?.info.running === true;
};

/*
 * Runs the merges with a toast each that follows the daemon's progress, and ends every refusal with
 * the one thing a person can do next: merge into the branch the project folder is on, stash their
 * own change and try again, or take a conflicting merge back.
 */
const mergeWithToasts = async (transport: Transport, folder: string, runs: readonly MergeRun[], done: () => void): Promise<void> => {
    const toasts = new Map<string, string>();
    const off = transport.on('git.progress', (payload) => {
        const toastId = toasts.get(payload.actionId);
        if (toastId !== undefined && payload.phase !== 'done' && payload.phase !== 'failed') {
            useToasts.getState().update(toastId, { title: phaseLabel(payload.phase), ...(payload.line === '' ? {} : { description: payload.line }) });
        }
    });
    const retry = (run: MergeRun, patch: Partial<MergeRun['payload']>): void => {
        void mergeWithToasts(transport, folder, [{ ...run, payload: { ...run.payload, ...patch } }], done);
    };
    try {
        await runMerges(
            transport,
            runs,
            nextActionId,
            (run, actionId) => {
                toasts.set(
                    actionId,
                    useToasts.getState().show({
                        title: `Merging ${run.worktree.branch}`,
                        kind: 'progress',
                        action: { label: 'Cancel', run: () => void transport.request('git.cancel', { actionId }).catch(() => undefined) }
                    })
                );
            },
            (outcome, actionId) => {
                const id = toasts.get(actionId);
                const run = runs.find((entry) => entry.worktree.path === outcome.worktree.path);
                const skipped = runs.length - 1 - runs.findIndex((entry) => entry.worktree.path === outcome.worktree.path);
                const rest =
                    outcome.kind !== 'merged' && skipped > 0
                        ? ` ${skipped === 1 ? 'The other worktree stays' : `The other ${skipped} worktrees stay`} as ${skipped === 1 ? 'it was' : 'they were'}.`
                        : '';
                useToasts.getState().show({ ...(id === undefined ? {} : { id }), ...toastOf(transport, folder, outcome, run, retry, rest) });
            }
        );
    } finally {
        off();
        done();
    }
};

const toastOf = (
    transport: Transport,
    folder: string,
    outcome: MergeOutcome,
    run: MergeRun | undefined,
    retry: (run: MergeRun, patch: Partial<MergeRun['payload']>) => void,
    rest: string
): Parameters<ReturnType<typeof useToasts.getState>['show']>[0] => {
    if (outcome.kind === 'merged') {
        const description = mergedDescription(outcome.result);
        return { title: outcome.result.summary, kind: 'success', ...(description === undefined ? {} : { description }) };
    }
    if (outcome.kind === 'conflict') {
        const cwd = outcome.result.cwd ?? folder;
        return {
            title: outcome.result.summary,
            description:
                (outcome.result.conflicts?.length ?? 0) > 0
                    ? `Resolve ${outcome.result.conflicts?.join(', ')} in the git panel and commit, or abort.${rest}`
                    : `Commit it in the git panel, or abort.${rest}`,
            kind: 'error',
            output: outcome.result.output,
            action: {
                label: 'Abort',
                run: () =>
                    void transport
                        .request('git.worktree-abort', { cwd })
                        .then(() => useToasts.getState().show({ title: 'Took the merge back', kind: 'success' }))
                        .catch((error: unknown) =>
                            useToasts
                                .getState()
                                .show({ title: 'Aborting failed', description: error instanceof Error ? error.message : undefined, kind: 'error' })
                        )
            }
        };
    }
    const title = `Merging ${outcome.worktree.branch} failed`;
    const base = { title, description: `${outcome.message.split('\n')[0]}${rest}`, kind: 'error' as const, output: outcome.message };
    if (run === undefined) {
        return base;
    }
    if (outcome.code === 'target-not-checked-out') {
        const branch = checkedOutBranch(outcome.message);
        return branch === null ? base : { ...base, action: { label: `Merge into ${branch}`, run: () => retry(run, { into: branch }) } };
    }
    if (isOverwriteRefusal(outcome)) {
        return {
            ...base,
            action: {
                label: 'Stash and retry',
                run: () =>
                    void stashTarget(transport, folder, outcome.worktree)
                        .then(() => retry(run, {}))
                        .catch((error: unknown) =>
                            useToasts
                                .getState()
                                .show({ title: 'Stashing failed', description: error instanceof Error ? error.message : undefined, kind: 'error' })
                        )
            }
        };
    }
    return base;
};

/* Moves the person's own changes in the target checkout into a stash they asked for, named so it is found again. */
const stashTarget = async (transport: Transport, folder: string, worktree: Worktree): Promise<void> => {
    const [status, list] = await Promise.all([transport.request('git.status', { cwd: folder }), transport.request('git.worktree-list', { repo: folder })]);
    const cwd = targetCheckout(folder, status.branch, list.worktrees, worktree.from?.branch);
    if (cwd === null) {
        throw new Error(`${worktree.from?.branch ?? 'The target branch'} is not checked out anywhere.`);
    }
    await transport.request('git.action', { cwd, actionId: nextActionId(), kind: 'stash', subject: `Before merging ${worktree.branch}` });
};
