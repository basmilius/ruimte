import { appendFile, cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorktreeAgents } from './worktree-merge.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@a' };

/* Keep fixtures independent of global signing and background maintenance on the runner. */
const TEST_GIT_CONFIG = {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'maintenance.auto',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'gc.auto',
    GIT_CONFIG_VALUE_1: '0',
    GIT_CONFIG_KEY_2: 'commit.gpgSign',
    GIT_CONFIG_VALUE_2: 'false'
};

/* For a test of git alone, where no agent works in any worktree. */
export const NO_WORKTREE_AGENTS: WorktreeAgents = { in: () => [], stop: async () => undefined };

/* Runs git in a test repository and answers what it wrote to stdout; a failure throws with its stderr. */
export async function gitIn(cwd: string, args: string[]): Promise<string> {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...IDENTITY, ...TEST_GIT_CONFIG } });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
        throw new Error(`git ${args.join(' ')}: ${stderr}`);
    }
    return stdout;
}

/* A repository on `main` with these files in one commit. */
export async function initRepo(repo: string, files: Record<string, string>): Promise<void> {
    await mkdir(repo, { recursive: true });
    // No template: its sample hooks are most of the files each test then copies, which costs on Windows.
    await gitIn(repo, ['init', '--quiet', '--initial-branch=main', '--template=']);
    await mkdir(join(repo, '.git', 'hooks'));
    // Application Git calls do not use gitIn's environment, so copied worktrees need these too, and the
    // line endings stay as written whatever the runner's autocrlf. One write, since every process counts.
    await appendFile(
        join(repo, '.git', 'config'),
        '[user]\n\tname = Ada\n\temail = a@a\n[commit]\n\tgpgSign = false\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n[core]\n\tautocrlf = false\n'
    );
    for (const [name, body] of Object.entries(files)) {
        await writeFile(join(repo, name), body);
    }
    await gitIn(repo, ['add', '.']);
    await gitIn(repo, ['commit', '--quiet', '--message', 'init']);
}

export interface RepoSnapshots {
    /* The one folder every test of the file works in, for the tests of a file run one after the other. */
    readonly root: string;
    /* Remembers what the root holds now under this name. */
    take(name: string): Promise<void>;
    /* Puts the root back to what it held at `take`. */
    restore(name: string): Promise<void>;
    dispose(): Promise<void>;
}

/*
 * For a fixture that holds a linked worktree, which `repoTemplate` cannot copy: its links and the
 * register's keys name absolute paths. The same root each time keeps them true, so the git calls that
 * made the worktree run once per file and not once per test.
 */
export async function repoSnapshots(prefix: string): Promise<RepoSnapshots> {
    const root = await realpath(await mkdtemp(join(tmpdir(), `${prefix}-`)));
    const saved = await mkdtemp(join(tmpdir(), `${prefix}-saved-`));
    return {
        root,
        async take(name) {
            await cp(root, join(saved, name), { recursive: true });
        },
        async restore(name) {
            await rm(root, { recursive: true, force: true, maxRetries: 5 });
            await cp(join(saved, name), root, { recursive: true });
        },
        async dispose() {
            await rm(root, { recursive: true, force: true, maxRetries: 5 });
            await rm(saved, { recursive: true, force: true, maxRetries: 5 });
        }
    };
}

export interface RepoTemplate {
    /* A fresh folder holding a copy of everything the template built, for one test to change. */
    copy(): Promise<string>;
    dispose(): Promise<void>;
}

/*
 * Every git call is a process, and starting processes is what a loaded CI runner is slowest at: a
 * fixture rebuilt with git before each test pushed single tests past Bun's five seconds. The fixture
 * is built once per file and copied per test, which costs no process at all.
 */
export async function repoTemplate(prefix: string, build: (root: string) => Promise<void>): Promise<RepoTemplate> {
    // Git reports real paths, and the temp dir sits behind a symlink on macOS (/var to /private/var).
    const template = await realpath(await mkdtemp(join(tmpdir(), `${prefix}-template-`)));
    await build(template);
    return {
        async copy() {
            const root = await realpath(await mkdtemp(join(tmpdir(), `${prefix}-`)));
            await cp(template, root, { recursive: true });
            return root;
        },
        async dispose() {
            await rm(template, { recursive: true, force: true, maxRetries: 5 });
        }
    };
}
