import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import type { ChatInfo } from '@ruimte/contracts';
import type { UiLinkResolution, UiLinkTarget } from '@adecore/intelligent-ui/links';
import { checkCwd, isInside } from '../canvas/project-paths.ts';
import { git, toplevel } from '../git/run.ts';
import type { UiSourceHosts } from './ui-sources.ts';
import { UiSourceAccessSchema } from './ui-access.ts';

export async function resolveUiProjectLink(host: UiSourceHosts, info: ChatInfo, input: unknown, target: UiLinkTarget): Promise<UiLinkResolution> {
    const access = UiSourceAccessSchema.parse(input);
    const place = host.place(info.chatId);
    if (!place || place.projectId !== access.projectId || (await realpath(place.folder)) !== access.folder) {
        throw new Error('The link belongs to another project.');
    }
    if (target.type === 'Node') {
        const node = host.node(target.id);
        if (!node || node.projectId !== place.projectId) {
            throw new Error('This node is outside the project or no longer available.');
        }
        return { state: 'chip', projectId: place.projectId, target, label: node.title, viewId: node.canvasId ?? undefined };
    }
    const cwd = await checkCwd(place.folder, access.cwd, host.worktreePaths);
    if (!access.roots.some((root) => isInside(root, cwd))) {
        throw new Error('The writer’s working directory is outside its original project.');
    }
    if (target.type === 'Commit') {
        const root = await toplevel(cwd);
        if (!root || !access.roots.some((allowed) => isInside(allowed, root))) {
            throw new Error('This repository is outside the writer’s original project.');
        }
        await checkCwd(place.folder, root, host.worktreePaths);
        const resolved = await git(['rev-parse', '--verify', `${target.sha}^{commit}`], root);
        if (!resolved) {
            throw new Error('This commit is no longer available.');
        }
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
    let path = resolve(access.cwd, target.path);
    let parent = path;
    const missing: string[] = [];
    let real: string;
    while (true) {
        try {
            real = await realpath(parent);
            break;
        } catch (error) {
            if (target.type !== 'Diff' || (error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(parent) === parent) {
                throw new Error('This file is no longer available.');
            }
            missing.unshift(basename(parent));
            parent = dirname(parent);
        }
    }
    path = resolve(real, ...missing);
    if (!access.roots.some((root) => isInside(root, path))) {
        throw new Error('This file is outside the writer’s original project.');
    }
    if (target.type === 'File' && !(await stat(real)).isFile()) {
        throw new Error('This target is not a file.');
    }
    await checkCwd(place.folder, missing.length ? real : dirname(real), host.worktreePaths);
    if (target.type === 'File') {
        return { state: 'chip', projectId: place.projectId, target: { ...target, path }, cwd, label: basename(path) };
    }
    const root = await toplevel(cwd);
    if (!root || !access.roots.some((allowed) => isInside(allowed, root)) || !isInside(root, path)) {
        throw new Error('This diff is outside the writer’s repository.');
    }
    await checkCwd(place.folder, root, host.worktreePaths);
    const status = await host.gitStatus(root);
    const changed = status.files.filter((file) => resolve(root, file.path) === path);
    if (!changed.length) {
        throw new Error('This file has no current diff.');
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
