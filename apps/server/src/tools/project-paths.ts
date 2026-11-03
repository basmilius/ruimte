import { lstat, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { climbsOut } from '../fs/path-segment.ts';
import { realOrNull } from '../fs/real-path.ts';

export function isInside(root: string, path: string): boolean {
    return !climbsOut(relative(root, path));
}

interface InsideRule {
    flag: string;
    /* The code a path that is not there answers with; each flag has one of its own, since that is what a script branches on. */
    badCode: string;
    outsideCode: string;
}

/*
 * The folders a tool may hand to a node or read a file from: the project folder and the worktrees
 * of its repository. An agent must not reach outside the project the person opened it in. Compared
 * on real paths, so neither a symlink inside the folder nor `/tmp` against `/private/tmp` decides it.
 */
async function checkInsideProject(
    folder: string,
    rule: InsideRule,
    path: string,
    worktreePaths: (folder: string) => Promise<string[]>,
    also: readonly string[] = []
): Promise<{ resolved: string; real: string }> {
    const resolved = resolve(folder, path);
    const real = await realOrNull(resolved);
    if (real === null) {
        throw new ToolRefusal(rule.badCode, `${resolved} is not there; ${rule.flag} is resolved against the project folder unless it is absolute`);
    }
    const realFolder = await realOrNull(folder);
    if (realFolder !== null && isInside(realFolder, real)) {
        return { resolved, real };
    }
    const paths = await worktreePaths(folder);
    const roots = await Promise.all([...paths, ...also].map(realOrNull));
    if (!roots.some((root) => root !== null && isInside(root, real))) {
        // The paths as git has them, not the real ones the comparison ran on: those are what a caller can type back.
        throw new ToolRefusal(
            rule.outsideCode,
            `${resolved} is outside ${folder}${also.length > 0 ? ', the other folders below' : ''} and the worktrees of its repository`,
            [
                `folder\t${folder}`,
                ...paths.filter((candidate) => candidate !== folder).map((candidate) => `worktree\t${candidate}`),
                ...also.map((candidate) => `also\t${candidate}`)
            ]
        );
    }
    return { resolved, real };
}

const CWD_RULE: InsideRule = { flag: 'cwd', badCode: 'bad-cwd', outsideCode: 'cwd-outside-project' };
const PROMPT_FILE_RULE: InsideRule = { flag: 'promptFile', badCode: 'bad-prompt-file', outsideCode: 'prompt-file-outside-project' };
const RESULT_FILE_RULE: InsideRule = { flag: 'resultFile', badCode: 'bad-result-file', outsideCode: 'result-file-outside-project' };
const FILE_RULE: InsideRule = { flag: 'the path', badCode: 'bad-path', outsideCode: 'path-outside-project' };
const DEVICE_PATH_RULE: InsideRule = { flag: 'path', badCode: 'device-path-refused', outsideCode: 'device-path-refused' };

/* Where a shell or an agent may start: a directory inside the project folder or a worktree of it. */
export async function checkCwd(folder: string, cwd: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    const { resolved, real } = await checkInsideProject(folder, CWD_RULE, cwd, worktreePaths);
    if (!(await stat(real)).isDirectory()) {
        throw new ToolRefusal('bad-cwd', `${resolved} is not a folder; cwd is resolved against the project folder unless it is absolute`);
    }
    return resolved;
}

interface StartCwdDeps {
    /* Whether an agent made this node, which is what put its cwd through `checkCwd` in the first place. */
    madeByAgent(nodeId: string): boolean;
    /* The folder of the project that places the node; null when no project this machine knows does. */
    folderOf(nodeId: string): string | null;
    worktreePaths(folder: string): Promise<string[]>;
}

/*
 * The cwd check again, at every start of a node an agent made. The tool checked a path that may be
 * a symlink, which anyone who can write in the folder can point elsewhere before a start, so only
 * the check right before the shell or the CLI spawns counts.
 */
export function startCwdGuard(deps: StartCwdDeps) {
    return async (nodeId: string, cwd: string): Promise<void> => {
        if (!deps.madeByAgent(nodeId)) {
            return;
        }
        const folder = deps.folderOf(nodeId);
        if (folder === null) {
            throw new ToolRefusal(CWD_RULE.outsideCode, `${nodeId} is in no project this machine knows, so ${cwd} cannot be held against its folder`);
        }
        await checkCwd(folder, cwd, deps.worktreePaths);
    };
}

async function insideFile(
    rule: InsideRule,
    folder: string,
    path: string,
    worktreePaths: (folder: string) => Promise<string[]>
): Promise<{ resolved: string; real: string }> {
    const inside = await checkInsideProject(folder, rule, path, worktreePaths);
    if (!(await stat(inside.real)).isFile()) {
        throw new ToolRefusal(rule.badCode, `${inside.resolved} is not a file; ${rule.flag} is resolved against the project folder unless it is absolute`);
    }
    return inside;
}

async function readInsideFile(rule: InsideRule, folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    return Bun.file((await insideFile(rule, folder, path, worktreePaths)).real).text();
}

/* A file of the project or of a worktree of it, as the path a caller gave resolves; a link that leads out of them is refused. */
export async function checkInsideFile(folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    return (await insideFile(FILE_RULE, folder, path, worktreePaths)).resolved;
}

/*
 * A file or an app bundle an agent hands a device, inside the project folder, its worktrees or the folders
 * in `also`, as its real path so a link swapped in after the check leads nowhere new. A bundle is a folder,
 * and the device copies the links in it along, so a link in it must stay inside too.
 */
export async function checkDevicePath(
    folder: string,
    path: string,
    worktreePaths: (folder: string) => Promise<string[]>,
    also: readonly string[] = []
): Promise<string> {
    const { real } = await checkInsideProject(folder, DEVICE_PATH_RULE, path, worktreePaths, also);
    if (!(await stat(real)).isDirectory()) {
        return real;
    }
    for (const name of await readdir(real, { recursive: true })) {
        const inner = join(real, name);
        if ((await lstat(inner)).isSymbolicLink()) {
            await checkInsideProject(folder, DEVICE_PATH_RULE, inner, worktreePaths, also);
        }
    }
    return real;
}

/* The prompt a caller put in a file, under the same folder rule a cwd follows. */
export function readPromptFile(folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    return readInsideFile(PROMPT_FILE_RULE, folder, path, worktreePaths);
}

/* The result of a task a child put in a file, under the same rule. */
export function readResultFile(folder: string, path: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    return readInsideFile(RESULT_FILE_RULE, folder, path, worktreePaths);
}

/*
 * A file a node points at. Unlike a cwd this one may sit outside the project: a person drags a file
 * onto the canvas from anywhere, and the node then keeps the absolute path.
 */
export async function checkPath(folder: string, path: string): Promise<string> {
    const resolved = resolve(folder, path);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) {
        throw new ToolRefusal('bad-path', `${resolved} is not a file; path is resolved against the project folder unless it is absolute`);
    }
    return resolved;
}
