import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import i18next from 'i18next';
import type { GitRepo, GitRepoKind, GitStatus } from '@ruimte/contracts';
import { basenameOf } from '@/shell/panels/files-tree';
import { GIT_PANEL_PACE_MS, paced, type Pace } from '@/shell/panels/pace';
import { watchGit } from '@/state/git-watch';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';

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
    /* Goes up whenever HEAD may have moved in this checkout, which is when the log has to be read
       again. A file that changed moves the status without moving a single commit, and a folder of nine
       repositories under an agent would otherwise reread nine logs a few times a second. */
    revision: number;
}

interface Entry {
    status: GitStatus | null;
    failure: string | null;
    revision: number;
}

/*
 * Whether HEAD could have moved between two statuses of one checkout. A commit, a pull, a rebase and
 * a checkout all show up in at least one of these; an edit to a file shows up in none of them.
 */
export const headMoved = (before: GitStatus | null, after: GitStatus): boolean =>
    before === null ||
    before.branch !== after.branch ||
    before.detached !== after.detached ||
    before.upstream !== after.upstream ||
    before.ahead !== after.ahead ||
    before.behind !== after.behind ||
    before.mergeBase !== after.mergeBase;

const BLANK: Entry = { status: null, failure: null, revision: 0 };

// One object for "nothing read yet", so the lists below are not rebuilt on a render that changed nothing.
const NOTHING: Record<string, Entry> = {};

/* The project folder as the only repository, which is what a machine without `git.repos` answers to. */
export const soleRepo = (folder: string): GitRepo[] => [{ path: folder, label: basenameOf(folder), kind: 'root' }];

/* The repositories the panel draws: the ones a person hid are out, by the label they were hidden under. */
export const visibleRepos = (repos: readonly GitRepo[], hidden: readonly string[]): GitRepo[] => {
    const away = new Set(hidden);
    return repos.filter((repo) => !away.has(repo.label));
};

/*
 * One checkout's status without the repositories standing inside it. A repository git does not track
 * shows up in the one above it as a single untracked folder (`inner/`), and the panel already draws
 * that repository as a section of its own; keeping the folder would say the same work twice. A
 * submodule is tracked and stays: its gitlink is a change the repository above it has to commit.
 */
export const withoutNestedRepos = (status: GitStatus | null, root: string, others: readonly string[]): GitStatus | null => {
    if (status === null) {
        return status;
    }
    const inside = new Set(others.filter((path) => path.startsWith(`${root}/`)).map((path) => `${path.slice(root.length + 1)}/`));
    if (inside.size === 0) {
        return status;
    }
    const files = status.files.filter((file) => file.state !== 'untracked' || !inside.has(file.path));
    // The same status back when nothing was dropped, so no tree is rebuilt over this.
    return files.length === status.files.length ? status : { ...status, files };
};

export interface ProjectRepos {
    repos: readonly GitRepo[];
    /* Set when the folder holds more repositories than the list carries. */
    truncated: boolean;
    /* Reads which repositories the folder holds again, for one that gained or lost a submodule. */
    reload(): void;
}

/*
 * Which repositories a project folder holds: the one the folder itself is in, its submodules, and the
 * ones sitting beside it. A folder of loose checkouts has one per checkout and an ordinary project has
 * exactly one, which is the panel as it always was.
 */
export const useProjectRepos = (folder: string | null): ProjectRepos => {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, String(folder));
    const [list, setList] = useState<{ key: string; repos: readonly GitRepo[]; truncated: boolean } | null>(null);
    /* Goes up to ask for the list again, which is what the refresh button does. */
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (folder === null) {
            return;
        }
        let cancelled = false;
        transport
            .request('git.repos', { folder })
            .then((answer) => {
                if (!cancelled) {
                    setList({ key, repos: answer.repos, truncated: answer.truncated });
                }
            })
            // A machine from before this verb still has the folder itself, which is what the panel used to show.
            .catch(() => {
                if (!cancelled) {
                    setList({ key, repos: soleRepo(folder), truncated: false });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, folder, key, nonce]);

    const reload = useCallback((): void => setNonce((count) => count + 1), []);
    const repos = useMemo(() => (list?.key === key ? list.repos : []), [list, key]);
    return { repos, truncated: list?.key === key && list.truncated, reload };
};

export interface GitCheckouts {
    checkouts: readonly GitCheckout[];
    /* Reads the status of one checkout, or of every one of them. */
    refresh(cwd?: string): Promise<void>;
}

/*
 * The status of every checkout the panel shows, each with its own watch and its own pace, so an agent
 * writing in one repository does not hold up the redraw of another.
 */
export const useGitCheckouts = (refs: readonly GitCheckoutRef[]): GitCheckouts => {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ endpointId: string; entries: Record<string, Entry> }>({ endpointId: '', entries: {} });
    /* One pace per checkout, so a status the daemon pushed for one repository waits its own turn. */
    const pacesRef = useRef(new Map<string, Pace<GitStatus>>());

    const show = useCallback(
        (cwd: string, status: GitStatus): void => {
            setHeld((previous) => {
                const entries = previous.endpointId === endpointId ? previous.entries : {};
                const before = entries[cwd] ?? BLANK;
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
                    return { endpointId, entries: { ...entries, [cwd]: { ...(entries[cwd] ?? BLANK), failure: message } } };
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
            const watch = watchGit(cwd);
            void watch.ready.then(() => read(cwd));
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

    const checkouts = useMemo(() => refs.map((ref) => ({ ...ref, ...(entries[ref.path] ?? BLANK) })), [refs, entries]);

    const refresh = useCallback(
        async (cwd?: string): Promise<void> => {
            const targets = cwd === undefined ? paths.split('\n').filter((path) => path !== '') : [cwd];
            await Promise.all(targets.map((path) => read(path)));
        },
        [read, paths]
    );

    return { checkouts, refresh };
};
