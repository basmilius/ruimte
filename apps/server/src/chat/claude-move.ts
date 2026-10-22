import { mkdir, realpath, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeProjectSlug, findClaudeSession } from '@adecore/agents/chat';
import { renameNoReplace } from '../fs/no-replace-rename.ts';
import { isPathSegment } from '../fs/path-segment.ts';
import { errorText } from '../error-text.ts';
import { ChatError } from './errors.ts';

export interface MovedTranscript {
    /* Puts back what moved, last first; a second call does nothing. */
    undo(): Promise<void>;
}

export interface MoveTranscriptOptions {
    projectsDir: string;
    sessionId: string;
    fromCwd: string;
    toCwd: string;
    /* Moves one path without replacing anything; the file system's `renameNoReplace` unless a test injects one. */
    rename?: (from: string, to: string) => Promise<void>;
}

async function isDirectory(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

/*
 * Moves a Claude session's transcript to the folder Claude Code keeps for the new working directory,
 * so `--resume` finds it there: the `<id>.jsonl` file and the `<id>` folder beside it, where its
 * subagents write. Nothing is replaced; a name already taken undoes what moved and refuses with `move-failed`.
 * The file is looked up by session id, since a slug the CLI wrote differently sits elsewhere.
 */
export async function moveClaudeTranscript(options: MoveTranscriptOptions): Promise<MovedTranscript> {
    const { projectsDir, sessionId, fromCwd, toCwd, rename = renameNoReplace } = options;
    if (!isPathSegment(sessionId)) {
        throw new ChatError('move-failed', 'Could not move the conversation');
    }
    const found = await findClaudeSession(projectsDir, sessionId, fromCwd);
    // Claude Code runs in the resolved folder (its working directory is never a symlink), so that is what it slugs.
    const targetDir = join(projectsDir, claudeProjectSlug(await realpath(toCwd).catch(() => toCwd)));
    // No file: a chat nobody wrote in, or a CLI that keeps none here. Already there: the folders share a slug.
    if (found === null || dirname(found) === targetDir) {
        return { undo: () => Promise.resolve() };
    }

    const moved: Array<{ from: string; to: string }> = [];
    let created: string | undefined;
    let undone = false;
    const undo = async (): Promise<void> => {
        if (undone) {
            return;
        }
        undone = true;
        let failure: unknown = null;
        for (const step of moved.toReversed()) {
            try {
                await rename(step.to, step.from);
            } catch (e) {
                failure ??= e;
            }
        }
        if (created !== undefined) {
            await rmdir(targetDir).catch(() => undefined);
        }
        if (failure !== null) {
            throw new ChatError('move-failed', `The conversation could not be put back where it was: ${errorText(failure)}`);
        }
    };

    try {
        created = await mkdir(targetDir, { recursive: true });
        const sessionFolder = join(dirname(found), sessionId);
        const parts = [{ from: found, to: join(targetDir, `${sessionId}.jsonl`) }];
        if (await isDirectory(sessionFolder)) {
            parts.push({ from: sessionFolder, to: join(targetDir, sessionId) });
        }
        for (const part of parts) {
            await rename(part.from, part.to);
            moved.push(part);
        }
    } catch (e) {
        await undo().catch(() => undefined);
        throw new ChatError('move-failed', `The conversation could not be moved: ${errorText(e)}`);
    }
    return { undo };
}
