import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { VerbRefusal } from './verb.ts';

export const isInside = (root: string, path: string): boolean => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null);

interface InsideRule {
    flag: string;
    /* The code a path that is not there answers with; each flag has one of its own, since that is what a script branches on. */
    badCode: string;
    outsideCode: string;
}

/*
 * The folders a verb may hand to a node or read a file from: the project folder and the worktrees
 * of its repository. An agent must not reach outside the project the person opened it in. Compared
 * on real paths, so neither a symlink inside the folder nor `/tmp` against `/private/tmp` decides it.
 */
const checkInsideProject = async (
    folder: string,
    rule: InsideRule,
    path: string,
    worktreePaths: (folder: string) => Promise<string[]>
): Promise<{ resolved: string; real: string }> => {
    const resolved = resolve(folder, path);
    const real = await realOrNull(resolved);
    if (real === null) {
        throw new VerbRefusal(rule.badCode, `${resolved} is not there; ${rule.flag} is resolved against the project folder unless it is absolute`);
    }
    const realFolder = await realOrNull(folder);
    if (realFolder !== null && isInside(realFolder, real)) {
        return { resolved, real };
    }
    const paths = await worktreePaths(folder);
    const worktrees = await Promise.all(paths.map(realOrNull));
    if (!worktrees.some((root) => root !== null && isInside(root, real))) {
        // The paths as git has them, not the real ones the comparison ran on: those are what a caller can type back.
        throw new VerbRefusal(rule.outsideCode, `${resolved} is outside ${folder} and the worktrees of its repository`, [
            `folder\t${folder}`,
            ...paths.filter((candidate) => candidate !== folder).map((candidate) => `worktree\t${candidate}`)
        ]);
    }
    return { resolved, real };
};

const CWD_RULE: InsideRule = { flag: '--cwd', badCode: 'bad-cwd', outsideCode: 'cwd-outside-project' };
const PROMPT_FILE_RULE: InsideRule = { flag: '--prompt-file', badCode: 'bad-prompt-file', outsideCode: 'prompt-file-outside-project' };
const RESULT_FILE_RULE: InsideRule = { flag: '--result-file', badCode: 'bad-result-file', outsideCode: 'result-file-outside-project' };

/* Where a shell or an agent may start: a directory inside the project folder or a worktree of it. */
export const checkCwd = async (folder: string, cwd: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> => {
    const { resolved, real } = await checkInsideProject(folder, CWD_RULE, cwd, worktreePaths);
    if (!(await stat(real)).isDirectory()) {
        throw new VerbRefusal('bad-cwd', `${resolved} is not a folder; --cwd is resolved against the project folder unless it is absolute`);
    }
    return resolved;
};

export interface StartCwdDeps {
    /* Whether an agent made this node, which is what put its cwd through `checkCwd` in the first place. */
    madeByAgent(nodeId: string): boolean;
    /* The folder of the project that places the node; null when no project this machine knows does. */
    folderOf(nodeId: string): string | null;
    worktreePaths(folder: string): Promise<string[]>;
}

/*
 * The cwd check again, at every start of a node an agent made. The verb checked a path that may be
 * a symlink, which anyone who can write in the folder can point elsewhere before a start, so only
 * the check right before the shell or the CLI spawns counts.
 */
export const startCwdGuard =
    (deps: StartCwdDeps) =>
    async (nodeId: string, cwd: string): Promise<void> => {
        if (!deps.madeByAgent(nodeId)) {
            return;
        }
        const folder = deps.folderOf(nodeId);
        if (folder === null) {
            throw new VerbRefusal(CWD_RULE.outsideCode, `${nodeId} is in no project this machine knows, so ${cwd} cannot be held against its folder`);
        }
        await checkCwd(folder, cwd, deps.worktreePaths);
    };

const readInsideFile = async (rule: InsideRule, folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> => {
    const { resolved, real } = await checkInsideProject(folder, rule, path, worktreePaths);
    if (!(await stat(real)).isFile()) {
        throw new VerbRefusal(rule.badCode, `${resolved} is not a file; ${rule.flag} is resolved against the project folder unless it is absolute`);
    }
    return Bun.file(real).text();
};

/* The prompt a caller put in a file, under the same folder rule a cwd follows. */
export const readPromptFile = (folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> =>
    readInsideFile(PROMPT_FILE_RULE, folder, path, worktreePaths);

/* The result of a task a child put in a file, under the same rule. */
export const readResultFile = (folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> =>
    readInsideFile(RESULT_FILE_RULE, folder, path, worktreePaths);

/*
 * A file a node points at. Unlike a cwd this one may sit outside the project: a person drags a file
 * onto the canvas from anywhere, and the node then keeps the absolute path.
 */
export const checkPath = async (folder: string, path: string): Promise<string> => {
    const resolved = resolve(folder, path);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) {
        throw new VerbRefusal('bad-path', `${resolved} is not a file; --path is resolved against the project folder unless it is absolute`);
    }
    return resolved;
};
