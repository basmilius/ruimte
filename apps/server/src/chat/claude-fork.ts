import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound, writeAtomic } from '../fs.ts';
import { claudeProjectSlug } from './claude-transcript.ts';
import { ChatError } from './errors.ts';

/* The Claude Code whose transcript this cut was checked against; the file is undocumented, so a change there is a refusal here. */
export const CLAUDE_TRANSCRIPT_CHECKED = '2.1.273';

/*
 * Where a fork is cut: after the line of the turn's last answer when the CLI named it, after the
 * first `turns` prompts when it did not (an older turn), or nowhere for the last turn of the chat.
 */
export type TranscriptCutPoint = { lastUuid: string } | { turns: number } | 'whole';

type Line = Record<string, unknown>;

const isRecord = (value: unknown): value is Line => typeof value === 'object' && value !== null && !Array.isArray(value);

const formatRefusal = (detail: string): ChatError =>
    new ChatError(
        'transcript-format',
        `Claude Code's conversation file has a shape this machine does not know (${detail}; checked against Claude Code ${CLAUDE_TRANSCRIPT_CHECKED}), so it cannot be forked`
    );

/* A prompt of the person or a wake, as opposed to a tool result, an injected skill or the summary a compaction leaves. */
const isSpokenPrompt = (line: Line): boolean => {
    if (line.type !== 'user' || line.isSidechain === true || line.isMeta === true || line.isCompactSummary === true) {
        return false;
    }
    const message = isRecord(line.message) ? line.message : null;
    const content = message?.content;
    if (typeof content === 'string') {
        return content !== '';
    }
    return (
        Array.isArray(content) &&
        content.some((block) => isRecord(block) && block.type === 'text') &&
        !content.some((block) => isRecord(block) && block.type === 'tool_result')
    );
};

/*
 * Claude Code 2.1.273 resumes a copied transcript cut after the chosen answer. Keep that turn's
 * trailing metadata, drop the next prompt's queued lines, and rewrite every retained session id.
 */
export const cutTranscript = (text: string, at: TranscriptCutPoint, sessionId: string, newSessionId: string): string => {
    const lines: Line[] = [];
    for (const raw of text.split('\n')) {
        if (raw.trim() === '') {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw formatRefusal('a line is not JSON');
        }
        if (!isRecord(parsed) || typeof parsed.type !== 'string') {
            throw formatRefusal('a line has no type');
        }
        lines.push(parsed);
    }
    const messages = lines.filter((line) => line.type === 'user' || line.type === 'assistant');
    if (messages.length === 0 || messages.some((line) => typeof line.uuid !== 'string' || line.sessionId !== sessionId || !isRecord(line.message))) {
        throw formatRefusal('its messages lack a uuid, a message or this session id');
    }

    let end = lines.length;
    if (at !== 'whole') {
        let start: number;
        if ('lastUuid' in at) {
            start = lines.findIndex((line) => line.uuid === at.lastUuid);
            if (start < 0) {
                throw formatRefusal(`no line carries the uuid ${at.lastUuid} the turn ended on`);
            }
        } else {
            let seen = 0;
            start = lines.findIndex((line) => isSpokenPrompt(line) && ++seen === at.turns);
            if (start < 0) {
                throw new ChatError(
                    'turn-not-found',
                    `Claude Code's conversation file has fewer than ${at.turns} prompts, so the turn could not be found in it`
                );
            }
        }
        const next = lines.findIndex((line, index) => index > start && isSpokenPrompt(line));
        end = next < 0 ? lines.length : next;
    }
    const lastMessage = lines.slice(0, end).findLastIndex((line) => typeof line.uuid === 'string');
    return lines
        .slice(0, end)
        .filter((line, index) => !(index > lastMessage && line.type === 'queue-operation'))
        .map((line) => `${JSON.stringify('sessionId' in line ? { ...line, sessionId: newSessionId } : line)}\n`)
        .join('');
};

/* The transcript of a session: in the folder of the chat's directory, else wherever the session id alone finds it. */
const findTranscript = async (projectsDir: string, cwd: string, sessionId: string): Promise<string | null> => {
    const own = join(projectsDir, claudeProjectSlug(cwd), `${sessionId}.jsonl`);
    if (existsSync(own)) {
        return own;
    }
    let dirs: string[];
    try {
        dirs = await readdir(projectsDir);
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
    return dirs.map((dir) => join(projectsDir, dir, `${sessionId}.jsonl`)).find((candidate) => existsSync(candidate)) ?? null;
};

export interface ClaudeForkInput {
    projectsDir: string;
    cwd: string;
    sessionId: string;
    at: TranscriptCutPoint;
    /* The directory the fork works in, whose folder under the projects is where `--resume` looks. */
    forkCwd: string;
    newSessionId: string;
}

/* Writes the fork's transcript and answers how to take it back when a later step of the fork is refused. */
export const forkClaudeTranscript = async (input: ClaudeForkInput): Promise<{ path: string; undo(): Promise<void> }> => {
    if (input.projectsDir === '' || /[/\\]|\.\./.test(input.sessionId)) {
        throw new ChatError('transcript-missing', 'Claude Code keeps no conversations on this machine');
    }
    const source = await findTranscript(input.projectsDir, input.cwd, input.sessionId);
    if (source === null) {
        throw new ChatError(
            'transcript-missing',
            `Claude Code's conversation file ${join(input.projectsDir, claudeProjectSlug(input.cwd), `${input.sessionId}.jsonl`)} is not there`
        );
    }
    const copy = cutTranscript(await readFile(source, 'utf8'), input.at, input.sessionId, input.newSessionId);
    const dir = join(input.projectsDir, claudeProjectSlug(input.forkCwd));
    const path = join(dir, `${input.newSessionId}.jsonl`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeAtomic(path, copy);
    return { path, undo: () => rm(path, { force: true }) };
};
