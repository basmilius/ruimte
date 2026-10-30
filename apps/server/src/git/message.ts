import type { GitSuggestMessageResult } from '@ruimte/contracts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { jsonObjectIn, oneShotProvider, runOneShot, type OneShotOptions } from './one-shot.ts';
import { git, toplevel, GitError } from './run.ts';
import type { TextInputBudget } from '../short-text/model.ts';

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
export function buildMessagePrompt(nameStatus: string, patch: string): string {
    return [
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
}

/* The message the CLI answered; output without one falls back to its first line as the subject. */
export function parseSuggestion(output: string): GitSuggestMessageResult | null {
    const parsed = jsonObjectIn(output);
    if (typeof parsed === 'object' && parsed !== null && 'subject' in parsed && typeof parsed.subject === 'string') {
        const body = 'body' in parsed && typeof parsed.body === 'string' ? parsed.body : '';
        return { subject: parsed.subject.trim(), body: body.trim() };
    }
    const first = output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '');
    return first === undefined ? null : { subject: first, body: '' };
}

/* What a commit message is written from: the staged patch, or the working tree when nothing is staged. */
async function stagedInput(top: string, budget?: TextInputBudget): Promise<{ nameStatus: string; patch: string } | null> {
    for (const scope of [['--cached'], []]) {
        const nameStatus = (await git(['diff', ...scope, '--name-status'], top)) ?? '';
        if (nameStatus.trim() !== '') {
            const patch = (await git(['diff', ...scope, '--no-color', '--no-ext-diff', '--unified=1'], top)) ?? '';
            return {
                nameStatus: bytePrefix(nameStatus, budget?.nameStatusBytes ?? MAX_NAME_STATUS_BYTES),
                patch: bytePrefix(patch, budget?.patchBytes ?? MAX_PATCH_BYTES)
            };
        }
    }
    return null;
}

function bytePrefix(text: string, limit: number): string {
    let bytes = 0;
    let end = 0;

    for (const character of text) {
        bytes += Buffer.byteLength(character);

        if (bytes > limit) {
            break;
        }

        end += character.length;
    }

    return text.slice(0, end);
}

/* A commit message for what is staged, written by the machine's own agent CLI. */
export async function suggestMessage(cwd: string, registry: ProviderRegistry, options: OneShotOptions = {}): Promise<GitSuggestMessageResult> {
    const top = await toplevel(cwd);
    const input = await stagedInput(top, options.writer?.budget);
    if (input === null) {
        throw new GitError('git-failed', 'There are no staged changes to describe.');
    }
    const provider = await oneShotProvider(registry, options, 'write a commit message');
    const result = await runOneShot(provider, top, buildMessagePrompt(input.nameStatus, input.patch), TIMEOUT_MS, options);
    const suggestion = result.code === 0 ? parseSuggestion(result.stdout) : null;
    if (suggestion === null || suggestion.subject === '') {
        throw new GitError('git-failed', `${provider.name} wrote no message: ${result.stderr.trim() || 'no output'}`);
    }
    return suggestion;
}
