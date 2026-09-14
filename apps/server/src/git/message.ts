import type { AgentKind, GitSuggestMessageResult } from '@ruimte/contracts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { git, streamCommand, toplevel, GitError } from './run.ts';

// Enough of the change for a subject line; a patch past this says nothing the first pages did not.
const MAX_PATCH_BYTES = 24 * 1024;
const MAX_NAME_STATUS_BYTES = 4 * 1024;
// A CLI that has not answered by now is one the person is waiting on for nothing.
const TIMEOUT_MS = 60_000;

/*
 * What the CLI is asked. It gets the file list and the patch and has to answer JSON, because a
 * model left to write freely opens with a sentence about what it is about to do, and that sentence
 * would land in the commit.
 */
export const buildMessagePrompt = (nameStatus: string, patch: string): string =>
    [
        'Write a git commit message for the staged changes below.',
        '',
        'Rules:',
        '- Answer with one JSON object and nothing else: {"subject": "...", "body": "..."}.',
        '- The subject is one line in the imperative mood, at most 72 characters, no trailing period.',
        '- Use the conventional commit form (feat:, fix:, chore:, refactor:, test:, docs:) when the change fits one.',
        '- The body explains why, wrapped at 72 characters, and is an empty string when the subject says it all.',
        '- American English. No em dashes or en dashes.',
        '',
        'Files:',
        nameStatus.trim() === '' ? '(none reported)' : nameStatus.trim(),
        '',
        'Patch:',
        patch.trim() === '' ? '(empty)' : patch.trim()
    ].join('\n');

/*
 * The JSON out of whatever the CLI wrote around it: a print-mode run still prints a line about the
 * session, and a model still opens with a word now and then. The last object in the output is the
 * answer; a run that holds none at all falls back to its first line as the subject.
 */
export const parseSuggestion = (output: string): GitSuggestMessageResult | null => {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const parsed: unknown = JSON.parse(output.slice(start, end + 1));
            if (typeof parsed === 'object' && parsed !== null && 'subject' in parsed && typeof parsed.subject === 'string') {
                const body = 'body' in parsed && typeof parsed.body === 'string' ? parsed.body : '';
                return { subject: parsed.subject.trim(), body: body.trim() };
            }
        } catch {
            // Not JSON after all, which the line below still makes something of.
        }
    }
    const first = output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '');
    return first === undefined ? null : { subject: first, body: '' };
};

/* What a commit message is written from: the staged patch, or the working tree when nothing is staged. */
const stagedInput = async (top: string): Promise<{ nameStatus: string; patch: string } | null> => {
    for (const scope of [['--cached'], []]) {
        const nameStatus = (await git(['diff', ...scope, '--name-status'], top)) ?? '';
        if (nameStatus.trim() !== '') {
            const patch = (await git(['diff', ...scope, '--no-color', '--no-ext-diff', '--unified=1'], top)) ?? '';
            return { nameStatus: nameStatus.slice(0, MAX_NAME_STATUS_BYTES), patch: patch.slice(0, MAX_PATCH_BYTES) };
        }
    }
    return null;
};

export interface SuggestOptions {
    provider?: AgentKind;
    /* The process, so `git.cancel` can end a CLI that is taking its time. */
    onSpawn?(kill: () => void): void;
}

/*
 * A commit message written by the agent CLI the machine already has, in its own one-shot print
 * mode: no chat, no session, no SDK, one process that reads a prompt and prints an answer.
 */
export const suggestMessage = async (cwd: string, registry: ProviderRegistry, options: SuggestOptions = {}): Promise<GitSuggestMessageResult> => {
    const top = await toplevel(cwd);
    const input = await stagedInput(top);
    if (input === null) {
        throw new GitError('git-failed', 'There are no staged changes to describe.');
    }
    const provider = await registry.oneShotProvider(options.provider);
    if (provider === null) {
        throw new GitError('git-failed', 'No agent CLI on this machine can write a commit message.');
    }
    const args = provider.oneShotArgs?.(buildMessagePrompt(input.nameStatus, input.patch)) ?? null;
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
        const suggestion = result.code === 0 ? parseSuggestion(result.stdout) : null;
        if (suggestion === null || suggestion.subject === '') {
            throw new GitError('git-failed', `${provider.name} wrote no message: ${result.stderr.trim() || 'no output'}`);
        }
        return suggestion;
    } finally {
        clearTimeout(timer);
    }
};
