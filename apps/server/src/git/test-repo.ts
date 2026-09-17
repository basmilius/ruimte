import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/* Runs git in a test repository and answers what it wrote to stdout; a failure throws with its stderr. */
export const gitIn = async (cwd: string, args: string[]): Promise<string> => {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...IDENTITY, ...TEST_GIT_CONFIG } });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
        throw new Error(`git ${args.join(' ')}: ${stderr}`);
    }
    return stdout;
};

/* A repository on `main` with these files in one commit. */
export const initRepo = async (repo: string, files: Record<string, string>): Promise<void> => {
    await mkdir(repo, { recursive: true });
    await gitIn(repo, ['init', '--quiet', '--initial-branch=main']);
    for (const [name, body] of Object.entries(files)) {
        await writeFile(join(repo, name), body);
    }
    await gitIn(repo, ['add', '.']);
    await gitIn(repo, ['commit', '--quiet', '--message', 'init']);
};

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
export const repoTemplate = async (prefix: string, build: (root: string) => Promise<void>): Promise<RepoTemplate> => {
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
            await rm(template, { recursive: true, force: true });
        }
    };
};
