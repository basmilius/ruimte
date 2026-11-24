import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { ChatUiRefusal, type ChatUiDiffRequest } from '@adecore/agents/chat';
import type { UiLinkResolution, UiLinkTarget } from '@adecore/intelligent-ui/links';
import { isNotFound } from '@adecore/utils/errors';
import { fileExists } from '@adecore/utils/fs';
import { isWithin } from '@adecore/utils/path';
import type { ChatInfo } from '@ruimte/contracts';
import { checkCwd } from '../canvas/project-paths.ts';
import { locateFile } from '../fs/locate.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import { git, toplevel, GitError } from '../git/run.ts';
import { UiSourceAccessSchema, type UiSourceAccess } from './ui-access.ts';
import type { UiSourceHosts } from './ui-sources.ts';

async function repositoryOf(directory: string): Promise<string | null> {
    try {
        return await realpath(await toplevel(directory));
    } catch {
        return null;
    }
}

interface LinkPlace {
    projectId: string;
    folder: string;
}

/*
 * The change an open Diff shows. The file is placed as its link is, so it lies in a repository of the
 * agent's project; one that names a revision is read from history and needs no change in the working tree.
 */
export async function readUiProjectDiff(host: UiSourceHosts, info: ChatInfo, input: unknown, request: ChatUiDiffRequest): Promise<{ patch: string }> {
    const { from, to } = request;
    const link = await resolveUiProjectLink(host, info, input, { type: 'Diff', path: request.path }, from !== undefined || to !== undefined);

    if (link.state !== 'chip' || link.cwd === undefined || link.relativePath === undefined) {
        throw new ChatUiRefusal(link.code ?? 'target-unavailable', link.reason ?? 'This file has no change to show.');
    }

    try {
        const change = await host.gitDiff(link.cwd, link.relativePath, {
            from,
            to,
            staged: link.staged === true,
            ignoreWhitespace: request.whitespace === 'hide'
        });

        if (change.omitted === 'binary') {
            throw new ChatUiRefusal('link-unsupported', 'This file is not text, so its change is not shown here.');
        }

        if (change.omitted !== undefined) {
            throw new ChatUiRefusal('target-unavailable', 'This change is too large to show here.');
        }

        return { patch: change.diff };
    } catch (error) {
        // A revision that is no commit, or a path git places outside the checkout.
        if (error instanceof GitError) {
            throw new ChatUiRefusal('target-unavailable', error.message);
        }

        throw error;
    }
}

/* `history` places a Diff that reads revisions, which needs no current change of its file. */
export async function resolveUiProjectLink(
    host: UiSourceHosts,
    info: ChatInfo,
    input: unknown,
    target: UiLinkTarget,
    history = false
): Promise<UiLinkResolution> {
    const access = UiSourceAccessSchema.parse(input);
    const place = host.place(info.chatId);
    if (!place || place.projectId !== access.projectId || (await realpath(place.folder)) !== access.folder) {
        return { state: 'plain', code: 'access-unavailable', reason: 'This chat moved to another project since the agent wrote this.' };
    }
    if (target.type === 'Node') {
        const node = host.node(target.id);
        if (!node || node.projectId !== place.projectId) {
            throw new ChatUiRefusal('target-unavailable', 'This node is outside the project or no longer available.');
        }
        if (node.hidden) {
            return { state: 'plain', label: node.title, reason: 'This agent works out of sight and has no node or view to open.' };
        }
        return { state: 'chip', projectId: place.projectId, target, label: node.title, viewId: node.canvasId ?? undefined };
    }
    const cwd = await checkCwd(place.folder, access.cwd, host.worktreePaths);
    if (!access.roots.some((root) => isWithin(root, cwd))) {
        return { state: 'plain', code: 'access-unavailable', reason: "The agent's working folder is outside the project it wrote this in." };
    }
    if (target.type === 'Commit') {
        return resolveCommit(host, place, access, cwd, target.sha);
    }
    return resolvePath(host, place, access, cwd, target, history);
}

async function resolveCommit(host: UiSourceHosts, place: LinkPlace, access: UiSourceAccess, cwd: string, wanted: string): Promise<UiLinkResolution> {
    // The agent's own repository first, then every other checkout of the project folder (submodules, repositories beside it).
    const candidates = new Set<string>();
    for (const directory of [cwd, ...(await cachedRepos(place.folder)).repos.map((repo) => repo.path)]) {
        const root = await repositoryOf(directory);
        if (root !== null && access.roots.some((allowed) => isWithin(allowed, root))) {
            candidates.add(root);
        }
    }
    for (const root of candidates) {
        const resolved = await git(['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`], root);
        if (!resolved) {
            continue;
        }
        await checkCwd(place.folder, root, host.worktreePaths);
        const sha = resolved.trim();
        const subject = await git(['show', '-s', '--format=%s', sha], root);
        return {
            state: 'chip',
            projectId: place.projectId,
            target: { type: 'Commit', sha },
            cwd: root,
            label: subject?.trim().slice(0, 256) || sha.slice(0, 7)
        };
    }
    throw new ChatUiRefusal('target-unavailable', 'This commit is no longer available.');
}

/* Where the agent's own folder has no such file, the first of the other folders `fs.locate` tries that holds it. */
async function locatedPath(place: LinkPlace, access: UiSourceAccess, wanted: string): Promise<string> {
    const own = resolve(access.cwd, wanted);
    if (isAbsolute(wanted) || (await fileExists(own))) {
        return own;
    }
    const { matches } = await locateFile({ path: wanted, cwd: access.cwd, folder: place.folder });
    return matches[0] ?? own;
}

async function resolvePath(
    host: UiSourceHosts,
    place: LinkPlace,
    access: UiSourceAccess,
    cwd: string,
    target: Extract<UiLinkTarget, { type: 'File' | 'Diff' }>,
    history: boolean
): Promise<UiLinkResolution> {
    let path = await locatedPath(place, access, target.path);
    let parent = path;
    const missing: string[] = [];
    let real: string;
    while (true) {
        try {
            real = await realpath(parent);
            break;
        } catch (error) {
            if (target.type !== 'Diff' || !isNotFound(error) || dirname(parent) === parent) {
                throw new ChatUiRefusal('target-unavailable', 'This file is no longer available.');
            }
            missing.unshift(basename(parent));
            parent = dirname(parent);
        }
    }
    path = resolve(real, ...missing);
    if (!access.roots.some((root) => isWithin(root, path))) {
        throw new ChatUiRefusal('outside-project', 'This file is outside the project the agent wrote this in.');
    }
    if (target.type === 'File' && !(await stat(real)).isFile()) {
        throw new ChatUiRefusal('link-unsupported', 'This target is not a file.');
    }
    await checkCwd(place.folder, missing.length ? real : dirname(real), host.worktreePaths);
    if (target.type === 'File') {
        return { state: 'chip', projectId: place.projectId, target: { ...target, path }, cwd, label: basename(path) };
    }
    const root = await repositoryOf(missing.length ? real : dirname(path));
    if (!root || !access.roots.some((allowed) => isWithin(allowed, root)) || !isWithin(root, path)) {
        throw new ChatUiRefusal('outside-project', "This diff is outside the repositories of the agent's project.");
    }
    await checkCwd(place.folder, root, host.worktreePaths);
    if (history) {
        return { state: 'chip', projectId: place.projectId, target: { ...target, path }, cwd: root, label: basename(path), relativePath: relative(root, path) };
    }
    const status = await host.gitStatus(root);
    const changed = status.files.filter((file) => resolve(root, file.path) === path);
    if (!changed.length) {
        throw new ChatUiRefusal('target-unavailable', 'This file has no current diff.');
    }
    return {
        state: 'chip',
        projectId: place.projectId,
        target: { ...target, path },
        cwd: root,
        label: basename(path),
        relativePath: relative(root, path),
        staged: changed.every((file) => file.state === 'staged'),
        conflicted: changed.some((file) => file.state === 'conflicted')
    };
}
