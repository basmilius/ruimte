import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import clsx from 'clsx';
import { Ban, Check, ChevronDown, ChevronUp, FileWarning, LoaderCircle, Sparkles, Wand2, X } from 'lucide-react';
import type { GitConflictFile, GitConflictsResult, GitOperation } from '@ruimte/contracts';
import { bothLines, sideLines, wandLines, type MergeSide } from '@ruimte/merge';
import { ConflictEditor, type EditorHandle } from '@/conflicts/ConflictEditor';
import { ConflictSides } from '@/conflicts/ConflictSides';
import { conflictIndexes, contentOf, draftWith, fileOf, nextConflict, openInDraft, usableBlocks, type ConflictFile } from '@/conflicts/conflict-model';
import type { ConflictDraft } from '@/conflicts/editor';
import { basenameOf } from '@/shell/panels/files-tree';
import { performAsPerson } from '@/actions/client-actions';
import { nextActionId } from '@/shell/panels/git-actions';
import { useGitStatus } from '@/state/git-watch';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

type Reading = { cwd: string; answer: GitConflictsResult } | { cwd: string; failure: string };

/* What is being asked of an agent right now, so the header can say it and the button can stop it. */
interface AiRun {
    actionId: string;
    done: number;
    total: number;
    path: string;
}

/*
 * Resolving what a pull, a merge or a rebase left behind. The merged file is the one editable side,
 * with every conflict marked where it sits; the two versions it came from are under it, a button
 * each. Nothing is written until a file is marked resolved, and the operation itself is only
 * finished or taken back from the row at the bottom.
 */
export function ConflictOverlay() {
    const { t } = useTranslation(['conflicts', 'common']);
    const request = useUi((s) => s.conflicts);
    const cwd = request?.cwd ?? null;
    const transport = useTransport();
    const status = useGitStatus(cwd);
    const [reading, setReading] = useState<Reading | null>(null);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [held, setHeld] = useState<{ path: string; file: ConflictFile } | null>(null);
    const [loading, setLoading] = useState(false);
    const [current, setCurrent] = useState<number | null>(null);
    const [settled, setSettled] = useState(false);
    const [wandable, setWandable] = useState(0);
    const [open, setOpen] = useState<Record<string, number>>({});
    const [busy, setBusy] = useState(false);
    const [run, setRun] = useState<AiRun | null>(null);
    /* Every file that has been read and what was made of it so far, so walking away from one and
       coming back lands on the same half-finished work. */
    const files = useRef(new Map<string, ConflictFile>());
    const drafts = useRef(new Map<string, ConflictDraft>());
    const editor = useRef<EditorHandle | null>(null);

    const answer = reading !== null && reading.cwd === cwd && 'answer' in reading ? reading.answer : null;
    const failure = reading !== null && reading.cwd === cwd && 'failure' in reading ? reading.failure : null;
    const list = useMemo<readonly GitConflictFile[]>(() => answer?.files ?? [], [answer]);

    /* The files git still holds unmerged, as one word: the list is read again when that word changes
       and not on every keystroke the working tree sees. */
    const signature = useMemo(
        () =>
            status === null
                ? ''
                : `${status.operation ?? ''}\u0000${status.files
                      .filter((file) => file.state === 'conflicted')
                      .map((file) => file.path)
                      .join('\u0000')}`,
        [status]
    );

    const read = useCallback((): void => {
        if (cwd === null) {
            return;
        }
        performAsPerson('git.conflicts', { repository: cwd })
            .then((next) => setReading({ cwd, answer: next }))
            .catch((error: unknown) => setReading({ cwd, failure: error instanceof Error ? error.message : t('failed') }));
    }, [cwd, t]);

    /* A fresh opening starts on the file it was pointed at, and forgets what was read for the one
       before it: the checkout may be another machine's. */
    useEffect(() => {
        files.current.clear();
        drafts.current.clear();
        setHeld(null);
        setOpen({});
        setRun(null);
        setActivePath(request?.path ?? null);
    }, [cwd, request?.path]);

    useEffect(() => {
        if (cwd !== null) {
            read();
        }
    }, [cwd, signature, read]);

    // The file in hand, or the first one left once the one before it was resolved.
    const activeFile = activePath !== null && list.some((file) => file.path === activePath) ? activePath : (list[0]?.path ?? null);

    useEffect(() => {
        if (cwd === null || activeFile === null) {
            setHeld(null);
            return;
        }
        const known = files.current.get(activeFile);
        if (known !== undefined) {
            setHeld({ path: activeFile, file: known });
            return;
        }
        let cancelled = false;
        setLoading(true);
        performAsPerson('git.conflict', { repository: cwd, path: activeFile })
            .then((result) => {
                if (cancelled) {
                    return;
                }
                const file = fileOf(result);
                files.current.set(activeFile, file);
                setHeld({ path: activeFile, file });
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setReading({ cwd, failure: error instanceof Error ? error.message : t('failed') });
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, cwd, activeFile, t]);

    const file = held !== null && held.path === activeFile ? held.file : null;
    const conflicts = useMemo(() => (file === null ? [] : conflictIndexes(file)), [file]);
    const openHere = activeFile === null ? 0 : (open[activeFile] ?? conflicts.length);
    const block = file !== null && current !== null ? (file.blocks[current] ?? null) : null;

    /* What the editor last said about the file on screen: where the caret is, whether that block is
       answered, and how many conflicts the wand could still close. */
    const onDraft = useCallback(
        (next: ConflictDraft, at: number | null): void => {
            if (activeFile === null) {
                return;
            }
            drafts.current.set(activeFile, next);
            const left = openInDraft(next);
            setOpen((previous) => (previous[activeFile] === left.length ? previous : { ...previous, [activeFile]: left.length }));
            const target = files.current.get(activeFile);
            setWandable(target === undefined ? 0 : left.filter((index) => wandLines(target.blocks[index]!) !== null).length);
            setCurrent(at);
            setSettled(at !== null && (next.spans.find((span) => span.block === at)?.settled ?? false));
        },
        [activeFile]
    );

    const onReady = useCallback((handle: EditorHandle | null): void => {
        editor.current = handle;
    }, []);

    const apply = (block: number, lines: readonly string[]): void => editor.current?.apply(block, lines);

    const go = (step: 1 | -1): void => {
        const next = nextConflict(conflicts, current, step);
        if (next !== null) {
            editor.current?.reveal(next);
            setCurrent(next);
        }
    };

    /* Every conflict nobody would think twice about, closed in one go. */
    const wand = (): void => {
        if (file === null) {
            return;
        }
        for (const index of openInDraft(drafts.current.get(file.path) ?? { text: '', spans: [] })) {
            const lines = wandLines(file.blocks[index]!);
            if (lines !== null) {
                apply(index, lines);
            }
        }
    };

    /* One file answered by the CLI on the machine. The proposals land as edits a person can undo,
       read and take back, since this is a proposal and not a commit. */
    const askOne = async (target: ConflictFile, actionId: string): Promise<number> => {
        if (cwd === null) {
            return 0;
        }
        const result = await performAsPerson('git.proposeResolution', { repository: cwd, path: target.path, run: actionId });
        const usable = usableBlocks(target, result.blocks);
        if (target.path === activeFile) {
            for (const entry of usable) {
                apply(entry.index, entry.lines);
            }
        } else {
            const answered = new Map(usable.map((entry) => [entry.index, entry.lines] as const));
            const next = draftWith(target, answered);
            drafts.current.set(target.path, next);
            setOpen((previous) => ({ ...previous, [target.path]: openInDraft(next).length }));
        }
        return usable.length;
    };

    const fileFor = async (path: string): Promise<ConflictFile | null> => {
        if (cwd === null) {
            return null;
        }
        const known = files.current.get(path);
        if (known !== undefined) {
            return known;
        }
        const result = await performAsPerson('git.conflict', { repository: cwd, path });
        const made = fileOf(result);
        files.current.set(path, made);
        return made;
    };

    const ask = async (paths: readonly string[]): Promise<void> => {
        const actionId = nextActionId();
        setBusy(true);
        let answered = 0;
        try {
            for (const [index, path] of paths.entries()) {
                setRun({ actionId, done: index, total: paths.length, path });
                const target = await fileFor(path);
                if (target === null || target.whole) {
                    continue;
                }
                answered += await askOne(target, actionId);
            }
            useToasts.getState().show({ title: answered === 0 ? t('ai.none') : t('ai.done', { count: answered }), kind: 'success' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('failed');
            useToasts.getState().show({ title: t('ai.failed'), description: message.split('\n')[0], kind: 'error', output: message });
        } finally {
            setRun(null);
            setBusy(false);
        }
    };

    /* One file written as it stands and staged, which is what takes it out of the list. */
    const write = async (path: string): Promise<void> => {
        const target = files.current.get(path);
        const written = drafts.current.get(path);
        if (cwd === null || target === undefined || written === undefined) {
            return;
        }
        await performAsPerson('git.resolveConflict', { repository: cwd, path, content: contentOf(target, written.text), take: null, hash: target.hash });
        files.current.delete(path);
        drafts.current.delete(path);
        setOpen((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== path)));
    };

    /* The files whose conflicts are all answered, written in one go. */
    const save = async (paths: readonly string[]): Promise<void> => {
        setBusy(true);
        try {
            for (const path of paths) {
                await write(path);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('failed');
            useToasts.getState().show({ title: t('save.failed'), description: message.split('\n')[0], kind: 'error', output: message });
        } finally {
            // Whatever went through is out of the list, so the next file that needs a person takes over.
            setActivePath(null);
            read();
            setBusy(false);
        }
    };

    /* One side of a file nobody merges line by line, or the file itself taken out. */
    const take = async (path: string, side: 'ours' | 'theirs' | 'delete'): Promise<void> => {
        if (cwd === null) {
            return;
        }
        setBusy(true);
        try {
            await performAsPerson('git.resolveConflict', { repository: cwd, path, content: null, take: side, hash: null });
            files.current.delete(path);
            drafts.current.delete(path);
            setActivePath(null);
            read();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('failed');
            useToasts.getState().show({ title: t('save.failed'), description: message.split('\n')[0], kind: 'error', output: message });
        } finally {
            setBusy(false);
        }
    };

    const finish = async (action: 'continue' | 'abort', operation: GitOperation): Promise<void> => {
        if (cwd === null) {
            return;
        }
        setBusy(true);
        try {
            const result = await performAsPerson('git.operation', { repository: cwd, step: action, run: nextActionId() });
            const left = result.conflicts.length;
            /* The daemon's summary is English wherever it lands; what happened is known here, so the
               toast says it in the language the rest of the overlay is in. */
            const title =
                action === 'abort' ? t('finish.aborted', { operation }) : left > 0 ? t('finish.more', { count: left }) : t('finish.done', { operation });
            useToasts.getState().show({ title, kind: 'success' });
            if (left === 0) {
                useUi.getState().setConflicts(null);
            } else {
                files.current.clear();
                drafts.current.clear();
                setActivePath(null);
                read();
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('failed');
            useToasts.getState().show({ title: t('finish.failed'), description: message.split('\n')[0], kind: 'error', output: message });
        } finally {
            setBusy(false);
        }
    };

    const close = (): void => useUi.getState().setConflicts(null);
    const operation = answer?.operation ?? status?.operation ?? null;
    const left = list.length;
    const textFiles = list.filter((entry) => entry.kind === 'text').map((entry) => entry.path);
    /* The files that are answered through and waiting to be written, the one on screen included. */
    const ready = list.filter((entry) => open[entry.path] === 0).map((entry) => entry.path);

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    className="dialog-popup flex h-[min(760px,88vh)] w-[min(1180px,94vw)] flex-col overflow-hidden p-0"
                    onKeyDown={(event) => {
                        // Walking the conflicts from the keyboard, with a modifier, while the caret is in the file.
                        if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                            event.preventDefault();
                            go(event.key === 'ArrowDown' ? 1 : -1);
                        }
                    }}
                >
                    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
                        <Dialog.Title className="text-sm font-semibold text-text">
                            {operation === null ? t('title.plain') : t(`title.${operation}`)}
                        </Dialog.Title>
                        {answer !== null && (
                            <span className="truncate text-xs text-text-muted">{t('sides', { ours: answer.ours, theirs: answer.theirs })}</span>
                        )}
                        <span className="grow" />
                        {run !== null && (
                            <span className="flex items-center gap-2 text-xs text-text-muted">
                                <Icon icon={LoaderCircle} size={12} className="animate-spin" />
                                {t('ai.working', { path: basenameOf(run.path), done: run.done + 1, total: run.total })}
                                <button
                                    className="h-6 rounded-md px-2 text-xs hover:bg-surface-hover"
                                    onClick={() => void transport.request('git.cancel', { actionId: run.actionId }).catch(() => undefined)}
                                >
                                    {t('common:action.cancel')}
                                </button>
                            </span>
                        )}
                        <span className={BTN_GROUP}>
                            <Tooltip label={t('nav.previous')} name>
                                <button className="icon-btn h-7 w-7" disabled={conflicts.length === 0} onClick={() => go(-1)}>
                                    <Icon icon={ChevronUp} size={14} />
                                </button>
                            </Tooltip>
                            <Tooltip label={t('nav.next')} name>
                                <button className="icon-btn h-7 w-7" disabled={conflicts.length === 0} onClick={() => go(1)}>
                                    <Icon icon={ChevronDown} size={14} />
                                </button>
                            </Tooltip>
                        </span>
                        <Tooltip label={wandable === 0 ? t('wand.nothing') : t('wand.tip', { count: wandable })}>
                            <button className="icon-btn h-7 w-7" disabled={wandable === 0 || busy} onClick={wand}>
                                <Icon icon={Wand2} size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip label={t('ai.file')}>
                            <button
                                className="icon-btn h-7 w-7"
                                disabled={busy || file === null || file.whole}
                                onClick={() => void ask(activeFile === null ? [] : [activeFile])}
                            >
                                <Icon icon={Sparkles} size={14} />
                            </button>
                        </Tooltip>
                        <Button size="sm" disabled={busy || textFiles.length === 0} onClick={() => void ask(textFiles)}>
                            {t('ai.all', { count: textFiles.length })}
                        </Button>
                        <Tooltip label={t('common:action.close')} name>
                            <button className="icon-btn h-7 w-7" onClick={close}>
                                <Icon icon={X} size={14} />
                            </button>
                        </Tooltip>
                    </header>

                    <div className="flex min-h-0 grow">
                        <nav className="w-64 shrink-0 overflow-y-auto border-r border-border py-1">
                            {list.length === 0 && <p className="px-3 py-4 text-xs text-text-faint">{t('list.none')}</p>}
                            {list.map((entry) => {
                                const remaining = open[entry.path];
                                return (
                                    <button
                                        key={entry.path}
                                        className={clsx(
                                            'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover',
                                            entry.path === activeFile && 'bg-surface-active'
                                        )}
                                        onClick={() => setActivePath(entry.path)}
                                    >
                                        <Icon
                                            icon={remaining === 0 ? Check : FileWarning}
                                            size={13}
                                            className={remaining === 0 ? 'shrink-0 text-status-idle' : 'shrink-0 text-status-needs-you'}
                                        />
                                        <span className="min-w-0 grow">
                                            <span className="block truncate text-xs text-text">{basenameOf(entry.path)}</span>
                                            <span className="block truncate text-xs text-text-faint">{entry.path}</span>
                                        </span>
                                        {remaining !== undefined && remaining > 0 && (
                                            <span className="shrink-0 text-xs text-text-faint tabular-nums">{remaining}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>

                        <div className="flex min-w-0 grow flex-col">
                            {failure !== null && <p className="border-b border-border px-3 py-2 text-xs text-status-error">{failure}</p>}
                            {list.length === 0 ? (
                                <div className="grid grow place-items-center px-6 text-center">
                                    <div>
                                        <Icon icon={Check} size={20} className="mx-auto text-status-idle" />
                                        <p className="mt-2 text-sm text-text">{t('empty.title')}</p>
                                        <p className="mt-1 text-xs text-text-muted">{operation === null ? t('empty.plain') : t(`empty.${operation}`)}</p>
                                    </div>
                                </div>
                            ) : file === null ? (
                                <div className="grid grow place-items-center text-xs text-text-faint">{loading ? t('loading') : t('list.pick')}</div>
                            ) : file.whole ? (
                                <WholeFile
                                    file={file}
                                    ours={answer?.ours ?? ''}
                                    theirs={answer?.theirs ?? ''}
                                    busy={busy}
                                    onTake={(side) => void take(file.path, side)}
                                />
                            ) : (
                                <>
                                    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
                                        <span className="truncate text-xs text-text-muted">{file.path}</span>
                                        <span className="grow" />
                                        <span className="text-xs text-text-faint tabular-nums">
                                            {t('counter', { open: openHere, total: conflicts.length })}
                                        </span>
                                    </div>
                                    <ConflictEditor file={file} held={() => drafts.current.get(file.path) ?? null} onChange={onDraft} onReady={onReady} />
                                    <div className="h-52 shrink-0 border-t border-border">
                                        <ConflictSides
                                            block={block}
                                            ours={answer?.ours ?? ''}
                                            theirs={answer?.theirs ?? ''}
                                            settled={settled}
                                            onTake={(side: MergeSide) => current !== null && block !== null && apply(current, sideLines(block, side))}
                                            onBoth={(first: MergeSide) => current !== null && block !== null && apply(current, bothLines(block, first))}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
                        <span className="text-xs text-text-muted">{left === 0 ? t('footer.done') : t('footer.left', { count: left })}</span>
                        <span className="grow" />
                        {operation !== null && (
                            <Button variant="ghost" disabled={busy} onClick={() => void finish('abort', operation)}>
                                <Icon icon={Ban} size={13} />
                                {t(`footer.abort.${operation}`)}
                            </Button>
                        )}
                        {ready.length > 1 && (
                            <Button variant="secondary" disabled={busy} onClick={() => void save(ready)}>
                                {t('footer.resolveAll', { count: ready.length })}
                            </Button>
                        )}
                        {file !== null && !file.whole && (
                            <Button variant="secondary" disabled={busy || openHere > 0} onClick={() => void save([file.path])}>
                                {t('footer.resolve')}
                            </Button>
                        )}
                        {operation !== null && (
                            <Button variant="primary" disabled={busy || left > 0} onClick={() => void finish('continue', operation)}>
                                {t(`footer.continue.${operation}`)}
                            </Button>
                        )}
                    </footer>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* A file that is not merged line by line: one side, the other, or gone. */
function WholeFile({
    file,
    ours,
    theirs,
    busy,
    onTake
}: {
    readonly file: ConflictFile;
    readonly ours: string;
    readonly theirs: string;
    readonly busy: boolean;
    onTake(side: 'ours' | 'theirs' | 'delete'): void;
}) {
    const { t } = useTranslation('conflicts');
    return (
        <div className="grid grow place-items-center px-6 text-center">
            <div className="max-w-md">
                <Icon icon={FileWarning} size={20} className="mx-auto text-status-needs-you" />
                <p className="mt-2 text-sm text-text">{file.path}</p>
                <p className="mt-1 text-xs text-text-muted">{t(`whole.${file.kind}`, { ours, theirs })}</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                    <Button disabled={busy || file.kind === 'deleted-by-us'} onClick={() => onTake('ours')}>
                        {t('whole.keepOurs', { ours })}
                    </Button>
                    <Button disabled={busy || file.kind === 'deleted-by-them'} onClick={() => onTake('theirs')}>
                        {t('whole.takeTheirs', { theirs })}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => onTake('delete')}>
                        {t('whole.drop')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
