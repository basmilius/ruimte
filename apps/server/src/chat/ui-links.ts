import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ChatInfo } from '@ruimte/contracts';
import type { UiLinkResolution, UiLinkTarget } from '@adecore/intelligent-ui/links';
import { fileExists, isNotFound } from '@adecore/agents';
import { ChatUiRefusal } from '@adecore/agents/chat';
import { checkCwd, isInside } from '../tools/project-paths.ts';
import { locateFile } from '../fs/locate.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import { git, toplevel } from '../git/run.ts';
import { UiSourceAccessSchema, type UiSourceAccess } from './ui-access.ts';
import type { UiSourceHosts } from './ui-sources.ts';

/* The real path of the repository a directory is in; null outside one. */
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

export async function resolveUiProjectLink(host: UiSourceHosts, info: ChatInfo, input: unknown, target: UiLinkTarget): Promise<UiLinkResolution> {
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
    if (!access.roots.some((root) => isInside(root, cwd))) {
        return { state: 'plain', code: 'access-unavailable', reason: "The agent's working folder is outside the project it wrote this in." };
    }
    if (target.type === 'Commit') {
        return resolveCommit(host, place, access, cwd, target.sha);
    }
    return resolvePath(host, place, access, cwd, target);
}

async function resolveCommit(host: UiSourceHosts, place: LinkPlace, access: UiSourceAccess, cwd: string, wanted: string): Promise<UiLinkResolution> {
    // The agent's own repository first, then every other checkout of the project folder (submodules, repositories beside it).
    const candidates = new Set<string>();
    for (const directory of [cwd, ...(await cachedRepos(place.folder)).repos.map((repo) => repo.path)]) {
        const root = await repositoryOf(directory);
        if (root !== null && access.roots.some((allowed) => isInside(allowed, root))) {
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
    target: Extract<UiLinkTarget, { type: 'File' | 'Diff' }>
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
    if (!access.roots.some((root) => isInside(root, path))) {
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
    if (!root || !access.roots.some((allowed) => isInside(allowed, root)) || !isInside(root, path)) {
        throw new ChatUiRefusal('outside-project', "This diff is outside the repositories of the agent's project.");
    }
    await checkCwd(place.folder, root, host.worktreePaths);
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
