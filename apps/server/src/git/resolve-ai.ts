import type { AgentKind, GitResolveAiResult, GitResolveBlock } from '@ruimte/contracts';
import { fingerprint, splitBlocks, splitLines, type MergeBlock } from '@ruimte/merge';
import type { ProviderRegistry } from '../providers/registry.ts';
import { readConflict } from './conflict.ts';
import { streamCommand, toplevel, GitError } from './run.ts';

// Lines of the file kept around a conflict, so a model reads what the stretch sits in.
const CONTEXT_LINES = 6;
// Enough of a file for a decision; past this the prompt says more about the file than about the conflict.
const MAX_PROMPT_BYTES = 24 * 1024;
// A CLI that has not answered by now is one the person is waiting on for nothing.
const TIMEOUT_MS = 120_000;

const block = (label: string, lines: readonly string[]): string => `${label}:\n${lines.length === 0 ? '(nothing)' : lines.join('\n')}`;

/*
 * What the CLI is asked. Every conflict is numbered and handed over with the version both sides
 * started from, so the model answers stretch by stretch instead of rewriting a file it only half
 * sees. JSON, because a model left to write freely opens with a sentence about what it is about to
 * do, and that sentence would end up in the code.
 */
export const buildResolvePrompt = (path: string, blocks: readonly MergeBlock[], ours: string, theirs: string): string => {
    const parts: string[] = [
        `Resolve the merge conflicts in ${path}.`,
        '',
        `"${ours}" is the side the checkout is on. "${theirs}" is the side coming in.`,
        '',
        'Rules:',
        '- Answer with one JSON object and nothing else: {"blocks": [{"index": 0, "lines": ["..."]}]}.',
        '- `lines` is the merged text of that conflict, one string per line, without line endings.',
        '- Keep both intentions where they can stand together. Never leave a conflict marker behind.',
        '- Change nothing outside the conflicts; the lines around them are there for reading only.',
        '- Leave a conflict out of the answer when picking a side is a judgement only the author can make.',
        ''
    ];
    for (const [index, entry] of blocks.entries()) {
        if (entry.kind !== 'conflict') {
            continue;
        }
        const before = blocks
            .slice(0, index)
            .flatMap((previous) => (previous.kind === 'stable' ? previous.base : []))
            .slice(-CONTEXT_LINES);
        const after = blocks
            .slice(index + 1)
            .flatMap((next) => (next.kind === 'stable' ? next.base : []))
            .slice(0, CONTEXT_LINES);
        parts.push(
            `Conflict ${index}`,
            block('Lines before', before),
            block('Both sides started from', entry.base),
            block(`Side "${ours}"`, entry.ours),
            block(`Side "${theirs}"`, entry.theirs),
            block('Lines after', after),
            ''
        );
        if (parts.join('\n').length > MAX_PROMPT_BYTES) {
            break;
        }
    }
    return parts.join('\n');
};

/* The blocks out of whatever the CLI wrote around them; anything that is not a stretch of lines is dropped. */
export const parseResolution = (output: string): { index: number; lines: string[] }[] => {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(output.slice(start, end + 1));
    } catch {
        return [];
    }
    if (typeof parsed !== 'object' || parsed === null || !('blocks' in parsed) || !Array.isArray(parsed.blocks)) {
        return [];
    }
    const answers: { index: number; lines: string[] }[] = [];
    for (const entry of parsed.blocks) {
        if (typeof entry !== 'object' || entry === null || !('index' in entry) || !('lines' in entry)) {
            continue;
        }
        const index = (entry as { index: unknown }).index;
        const lines = (entry as { lines: unknown }).lines;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || !Array.isArray(lines)) {
            continue;
        }
        if (lines.every((line) => typeof line === 'string')) {
            answers.push({ index, lines: lines as string[] });
        }
    }
    return answers;
};

export interface ResolveOptions {
    provider?: AgentKind;
    /* The process, so `git.cancel` can end a CLI that is taking its time. */
    onSpawn?(kill: () => void): void;
}

/*
 * A conflict answered by the agent CLI the machine already has, in its own one-shot print mode: no
 * chat, no session, no SDK. What comes back is a proposal per stretch, checked against the stretch it
 * was written for; nothing is written to the file here, since a person accepts the answer, not this.
 */
export const resolveWithAgent = async (
    cwd: string,
    path: string,
    sides: { ours: string; theirs: string },
    registry: ProviderRegistry,
    options: ResolveOptions = {}
): Promise<GitResolveAiResult> => {
    const top = await toplevel(cwd);
    const conflict = await readConflict(top, path);
    if (conflict.kind !== 'text' || conflict.ours === null || conflict.theirs === null) {
        throw new GitError('git-failed', `${path} is not a file an agent can merge line by line.`);
    }
    const blocks = splitBlocks(splitLines(conflict.base ?? ''), splitLines(conflict.ours), splitLines(conflict.theirs));
    const open = blocks.filter((entry) => entry.kind === 'conflict');
    if (open.length === 0) {
        return { blocks: [] };
    }
    const provider = await registry.oneShotProvider(options.provider);
    if (provider === null) {
        throw new GitError('git-failed', 'No agent CLI on this machine can resolve a conflict.');
    }
    const args = provider.oneShotArgs?.(buildResolvePrompt(path, blocks, sides.ours, sides.theirs)) ?? null;
    if (args === null) {
        throw new GitError('git-failed', `${provider.name} cannot answer a single prompt.`);
    }
    let kill: (() => void) | null = null;
    const timer = setTimeout(() => kill?.(), TIMEOUT_MS);
    try {
        const result = await streamCommand(provider.command[0]!, args, top, {
            onSpawn: (stop) => {
                kill = stop;
                options.onSpawn?.(stop);
            }
        });
        if (result.code !== 0) {
            throw new GitError('git-failed', `${provider.name} stopped: ${result.stderr.trim() || 'no output'}`);
        }
        const answers: GitResolveBlock[] = [];
        for (const answer of parseResolution(result.stdout)) {
            const entry = blocks[answer.index];
            // An answer for a stretch that is not a conflict is one the model made up.
            if (entry !== undefined && entry.kind === 'conflict') {
                answers.push({ index: answer.index, fingerprint: fingerprint(entry), lines: answer.lines });
            }
        }
        const left = open.length - answers.length;
        return {
            blocks: answers,
            ...(left > 0 ? { note: `${provider.name} left ${left} of ${open.length} conflicts for you.` } : {})
        };
    } finally {
        clearTimeout(timer);
    }
};
