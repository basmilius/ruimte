import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import i18next from 'i18next';
import type { GitFile, GitRepo, GitRepoKind, GitStatus } from '@ruimte/contracts';
import { basenameOf, isPathBelow, relativeTo } from '@/shell/panels/files-tree';
import { GIT_PANEL_PACE_MS, paced, type Pace } from '@/shell/panels/pace';
import { watchGit } from '@/state/git-watch';
import { endpointKey, useEndpointId } from '@/state/keys';
import { transportFor } from '@/transport';
import { useTransport } from '@/transport/context';
import { isConnectionError, TransportError, type Transport } from '@/transport/transport';

/* A checkout the panel can draw: a repository of the project folder, or the worktree a selection on
   the canvas points it at. A worktree is never one of the folder's repositories, which is why the
   kind of a checkout is wider than the kind on the wire. */
export interface GitCheckoutRef {
    path: string;
    label: string;
    kind: GitRepoKind | 'worktree';
}

export interface GitCheckout extends GitCheckoutRef {
    /* Null until this checkout's first status lands. */
    status: GitStatus | null;
    failure: string | null;
    /* Goes up whenever HEAD may have moved, which is when the log has to be read again. A file that
       changed moves the status without moving a commit, so it leaves the log alone. */
    revision: number;
}

interface Entry {
    status: GitStatus | null;
    failure: string | null;
    revision: number;
}

/*
 * The status as staging or unstaging these paths will leave it, drawn while git works so the box
 * moves under the click. It is a guess: the status that follows the action replaces it.
 */
export function assumeStaged(status: GitStatus, paths: readonly string[], staged: boolean): GitStatus {
    const moved = new Set(paths);
    const leaving = (file: GitFile): boolean =>
        moved.has(file.path) && (staged ? file.state === 'unstaged' || file.state === 'untracked' : file.state === 'staged');
    const landed = new Set(
        status.files
            .filter((file) => moved.has(file.path) && (staged ? file.state === 'staged' : file.state === 'unstaged' || file.state === 'untracked'))
            .map((file) => file.path)
    );
    const files: GitFile[] = [];
    for (const file of status.files) {
        if (!leaving(file)) {
            files.push(file);
            continue;
        }
        if (landed.has(file.path)) {
            continue;
        }
        landed.add(file.path);
        if (staged) {
            files.push({ ...file, state: 'staged', status: file.status === '?' ? 'A' : file.status });
        } else {
            const { oldPath: _oldPath, ...rest } = file;
            files.push(file.status === 'A' ? { ...rest, state: 'untracked', status: '?' } : { ...rest, state: 'unstaged' });
        }
    }
    return { ...status, files };
}

/*
 * Whether HEAD could have moved between two statuses of one checkout. A commit, a pull, a rebase and
 * a checkout all show up in at least one of these; an edit to a file shows up in none of them. The
 * first status is no move: the log is read beside it, and reading it again threw that page away.
 */
export function headMoved(before: GitStatus | null, after: GitStatus): boolean {
    if (before === null) {
        return false;
    }
    return (
        before.branch !== after.branch ||
        before.detached !== after.detached ||
        before.upstream !== after.upstream ||
        before.ahead !== after.ahead ||
        before.behind !== after.behind ||
        before.mergeBase !== after.mergeBase
    );
}

const BLANK: Entry = { status: null, failure: null, revision: 0 };

// One object for "nothing read yet", so the lists below are not rebuilt on a render that changed nothing.
const NOTHING: Record<string, Entry> = {};

/* What the panel last read per machine and path. Switching panels takes the git panel down, so without
   these every visit waits on the repositories, a watch and a status before it draws one row. */
const lastRepos = new Map<string, { repos: readonly GitRepo[]; truncated: boolean }>();
const lastEntries = new Map<string, Entry>();

/* The repositories the panel draws: the ones a person hid are out, by the label they were hidden under. */
export function visibleRepos(repos: readonly GitRepo[], hidden: readonly string[]): GitRepo[] {
    const away = new Set(hidden);
    return repos.filter((repo) => !away.has(repo.label));
}

/*
 * One checkout's status without the repositories standing inside it. A repository git does not track
 * shows up in the one above it as a single untracked folder (`inner/`), and the panel already draws
 * that repository as a section of its own; keeping the folder would say the same work twice. A
 * submodule is tracked and stays: its gitlink is a change the repository above it has to commit.
 */
export function withoutNestedRepos(status: GitStatus | null, root: string, others: readonly string[]): GitStatus | null {
    if (status === null) {
        return status;
    }
    const inside = new Set(others.filter((path) => isPathBelow(root, path)).map((path) => `${relativeTo(root, path)}/`));
    if (inside.size === 0) {
        return status;
    }
    const files = status.files.filter((file) => file.state !== 'untracked' || !inside.has(file.path));
    // The same status back when nothing was dropped, so no tree is rebuilt over this.
    return files.length === status.files.length ? status : { ...status, files };
}

/* The project folder as the only repository. */
export function soleRepo(folder: string): GitRepo[] {
    return [{ path: folder, label: basenameOf(folder), kind: 'root' }];
}

/*
 * Asks which repositories a folder holds. A real answer, an empty one included, goes to `answered`.
 * A link that dropped answers nothing: the list on screen stays and `again` fires once the link is
 * open. An ask that timed out on a link that stays open goes to `timedOut`, since no status change
 * would ever ask again. Any other failure is an answer of no repository. Returns the cancel.
 */
export function readProjectRepos(
    transport: Pick<Transport, 'request' | 'subscribeStatus'>,
    folder: string,
    fresh: boolean,
    on: { answered(answer: { repos: readonly GitRepo[]; truncated: boolean }): void; again(): void; timedOut(): void }
): () => void {
    let cancelled = false;
    let stopWaiting: (() => void) | null = null;
    transport
        .request('git.repos', fresh ? { folder, fresh } : { folder })
        .then((answer) => {
            if (!cancelled) {
                on.answered({ repos: answer.repos, truncated: answer.truncated });
            }
        })
        .catch((error: unknown) => {
            if (cancelled) {
                return;
            }
            if (error instanceof TransportError && error.code === 'timeout') {
                on.timedOut();
                return;
            }
            if (isConnectionError(error)) {
                stopWaiting = transport.subscribeStatus((status) => {
                    if (status === 'open') {
                        stopWaiting?.();
                        on.again();
                    }
                });
                return;
            }
            on.answered({ repos: [], truncated: false });
        });
    return () => {
        cancelled = true;
        stopWaiting?.();
    };
}

export interface ProjectRepos {
    repos: readonly GitRepo[];
    /* Set when the folder holds more repositories than the list carries. */
    truncated: boolean;
    /* Reads which repositories the folder holds again, past the machine's cache, for one that gained or lost a submodule. */
    reload(): void;
}

/*
 * Which repositories a project folder holds: the one the folder itself is in, its submodules, and the
 * ones sitting beside it. A folder of loose checkouts has one per checkout and an ordinary project has
 * exactly one, which is the panel as it always was.
 */
export function useProjectRepos(folder: string | null): ProjectRepos {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, String(folder));
    const [list, setList] = useState<{ key: string; repos: readonly GitRepo[]; truncated: boolean } | null>(null);
    /* Goes up to ask for the list again, which is what the refresh button does. */
    const [nonce, setNonce] = useState(0);
    const freshRef = useRef(false);

    useEffect(() => {
        if (folder === null) {
            return;
        }
        const fresh = freshRef.current;
        freshRef.current = false;
        return readProjectRepos(transport, folder, fresh, {
            answered: (answer) => {
                lastRepos.set(key, { repos: answer.repos, truncated: answer.truncated });
                setList({ key, repos: answer.repos, truncated: answer.truncated });
            },
            again: () => setNonce((count) => count + 1),
            // The folder itself stands in until a refresh answers, as it did before the machine listed repositories.
            timedOut: () => setList((previous) => (previous?.key === key ? previous : { key, repos: soleRepo(folder), truncated: false }))
        });
    }, [transport, folder, key, nonce]);

    const reload = (): void => {
        freshRef.current = true;
        setNonce((count) => count + 1);
    };
    const shown = list?.key === key ? list : lastRepos.get(key);
    const repos = shown?.repos ?? [];
    return { repos, truncated: shown?.truncated === true, reload };
}

/* Whether a folder is in a git repository of the machine on screen; false until the machine answered. */
export function useFolderInRepo(folder: string | null): boolean {
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, String(folder));
    const [answer, setAnswer] = useState<{ key: string; repos: readonly GitRepo[] } | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        const transport = transportFor(endpointId);
        if (folder === null || transport === null) {
            return;
        }
        return readProjectRepos(transport, folder, false, {
            answered: (listed) => setAnswer({ key, repos: listed.repos }),
            again: () => setNonce((count) => count + 1),
            timedOut: () => undefined
        });
    }, [endpointId, folder, key, nonce]);

    return folder !== null && answer?.key === key && answer.repos.some((repo) => repo.kind === 'root');
}

export interface GitCheckouts {
    checkouts: readonly GitCheckout[];
    /* Draws a status the panel expects until the next real one lands. */
    assume(cwd: string, next: (status: GitStatus) => GitStatus): void;
    /* Reads the status of one checkout, or of every one of them. */
    refresh(cwd?: string): Promise<void>;
}

/*
 * The status of every checkout the panel shows, each with its own watch and its own pace, so an agent
 * writing in one repository does not hold up the redraw of another.
 */
export function useGitCheckouts(refs: readonly GitCheckoutRef[]): GitCheckouts {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ endpointId: string; entries: Record<string, Entry> }>({ endpointId: '', entries: {} });
    /* One pace per checkout, so a status the daemon pushed for one repository waits its own turn. */
    const pacesRef = useRef(new Map<string, Pace<GitStatus>>());

    const show = useCallback(
        (cwd: string, status: GitStatus): void => {
            setHeld((previous) => {
                const entries = previous.endpointId === endpointId ? previous.entries : {};
                const before = entries[cwd] ?? lastEntries.get(endpointKey(endpointId, cwd)) ?? BLANK;
                const revision = before.revision + (headMoved(before.status, status) ? 1 : 0);
                return { endpointId, entries: { ...entries, [cwd]: { status, failure: null, revision } } };
            });
        },
        [endpointId]
    );

    const read = useCallback(
        async (cwd: string): Promise<void> => {
            try {
                show(cwd, await transport.request('git.status', { cwd }));
                pacesRef.current.get(cwd)?.mark();
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : i18next.t('panels:git.panel.statusFailed');
                setHeld((previous) => {
                    const entries = previous.endpointId === endpointId ? previous.entries : {};
                    return {
                        endpointId,
                        entries: { ...entries, [cwd]: { ...(entries[cwd] ?? lastEntries.get(endpointKey(endpointId, cwd)) ?? BLANK), failure: message } }
                    };
                });
            }
        },
        [transport, show, endpointId]
    );

    /* The checkouts as one string, so an unchanged list does not take down every watch and put it back. */
    const paths = useMemo(() => refs.map((ref) => ref.path).join('\n'), [refs]);

    useEffect(() => {
        const paces = pacesRef.current;
        const cwds = paths === '' ? [] : paths.split('\n');
        const taken = cwds.map((cwd) => {
            const pace = paced(GIT_PANEL_PACE_MS, (status: GitStatus) => show(cwd, status));
            paces.set(cwd, pace);
            // The watch goes up before the first status, so a write in between is reported, not missed.
            const watch = watchGit(cwd, () => void read(cwd));
            void watch.answer.then((answer) => {
                if (answer?.status === undefined) {
                    void read(cwd);
                } else {
                    show(cwd, answer.status);
                    pace.mark();
                }
            });
            return { cwd, watch, pace };
        });
        return () => {
            for (const entry of taken) {
                entry.pace.stop();
                paces.delete(entry.cwd);
                entry.watch.release();
            }
        };
    }, [paths, endpointId, show, read]);

    useEffect(() => {
        // A status of a checkout this panel does not follow has no pace and is dropped here.
        return transport.on('git.status', (payload) => {
            pacesRef.current.get(payload.cwd)?.offer(payload.status);
        });
    }, [transport]);

    // The same path on the machine that left says nothing about the same path here.
    const entries = held.endpointId === endpointId ? held.entries : NOTHING;

    /* The checkouts the daemon gave up watching; they only move when this window asks them to. */
    const dead = useMemo(
        () =>
            refs
                .filter((ref) => entries[ref.path]?.status?.live === false)
                .map((ref) => ref.path)
                .join('\n'),
        [refs, entries]
    );

    useEffect(() => {
        if (dead === '') {
            return;
        }
        const onFocus = (): void => {
            for (const cwd of dead.split('\n')) {
                void read(cwd);
            }
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [dead, read]);

    useEffect(() => {
        for (const [cwd, entry] of Object.entries(entries)) {
            lastEntries.set(endpointKey(endpointId, cwd), entry);
        }
    }, [entries, endpointId]);

    const checkouts = useMemo(
        () => refs.map((ref) => ({ ...ref, ...(entries[ref.path] ?? lastEntries.get(endpointKey(endpointId, ref.path)) ?? BLANK) })),
        [refs, entries, endpointId]
    );

    const refresh = useCallback(
        async (cwd?: string): Promise<void> => {
            const targets = cwd === undefined ? paths.split('\n').filter((path) => path !== '') : [cwd];
            await Promise.all(targets.map((path) => read(path)));
        },
        [read, paths]
    );

    const assume = useCallback(
        (cwd: string, next: (status: GitStatus) => GitStatus): void => {
            setHeld((previous) => {
                const entries = previous.endpointId === endpointId ? previous.entries : {};
                const entry = entries[cwd] ?? lastEntries.get(endpointKey(endpointId, cwd));
                if (entry === undefined || entry.status === null) {
                    return previous;
                }
                return { endpointId, entries: { ...entries, [cwd]: { ...entry, status: next(entry.status) } } };
            });
        },
        [endpointId]
    );

    return { checkouts, refresh, assume };
}
