/* Whether `path` is `folder` or sits under it, with the separator of either kind of machine. */
function within(folder: string, path: string): boolean {
    const base = folder.replace(/[\\/]+$/, '');
    return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/*
 * Whether a git status of `cwd` may change what a UI block of a chat reads: a checkout in the chat's
 * project folder, or the one its own working folder is in (a worktree sits outside the folder).
 * Without a project to compare with, every status may.
 */
export function gitStatusConcernsChat(cwd: string, project: { folder: string } | null, chatCwd: string | null): boolean {
    if (project === null) {
        return true;
    }
    return within(project.folder, cwd) || (chatCwd !== null && (within(cwd, chatCwd) || within(chatCwd, cwd)));
}
