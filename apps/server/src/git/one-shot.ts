import type { AgentKind } from '@ruimte/contracts';
import type { ChatProvider } from '@adecore/agents/providers';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { TextWriter } from '../short-text/model.ts';
import { GitError, streamWithTimeout, type GitResult } from './run.ts';

/*
 * A git task answered by the agent CLI the machine already has, in its own one-shot print mode: no
 * chat, no session, no SDK, one process that reads a prompt and prints an answer.
 */
export interface OneShotOptions {
    provider?: AgentKind;
    writer?: TextWriter;
    /* The process, so `git.cancel` can end a CLI that is taking its time. */
    onSpawn?(kill: () => void): void;
    /* Where the CLI runs for a checkout; the checkout itself unless it is not to be trusted with the CLI's configuration. */
    cwdFor?(folder: string): Promise<string>;
}

/* The CLI that answers, or a refusal that says no CLI here can `task`. */
export async function oneShotProvider(registry: ProviderRegistry, options: OneShotOptions, task: string): Promise<ChatProvider> {
    if (options.writer !== undefined) {
        return options.writer.provider;
    }

    const provider = await registry.oneShotProvider(options.provider);
    if (provider === null) {
        throw new GitError('git-failed', `No agent CLI on this machine can ${task}.`);
    }
    return provider;
}

/* How a one-shot CLI gets its prompt: on stdin where it reads it there, since an argument is capped and shows in the process list. */
export function oneShotRun(provider: ChatProvider, prompt: string, model: string | null = null): { args: string[]; stdin?: string } | null {
    const modelArgs = model === null || model === 'default' ? [] : ['--model', model];

    if (provider.oneShotStdinArgs) {
        const args = [...provider.oneShotStdinArgs];
        const position = provider.kind === 'codex' && args.at(-1) === '-' ? args.length - 1 : args.length;
        args.splice(position, 0, ...modelArgs);

        return { args, stdin: prompt };
    }
    const args = provider.oneShotArgs?.(prompt) ?? null;
    return args === null ? null : { args: [...args, ...modelArgs] };
}

export async function runOneShot(provider: ChatProvider, top: string, prompt: string, timeoutMs: number, options: OneShotOptions): Promise<GitResult> {
    if (options.writer !== undefined) {
        return options.writer.run(top, prompt, timeoutMs, options.onSpawn);
    }

    const run = oneShotRun(provider, prompt);
    if (run === null) {
        throw new GitError('git-failed', `${provider.name} cannot answer a single prompt.`);
    }
    return await streamWithTimeout(provider.command[0]!, run.args, (await options.cwdFor?.(top)) ?? top, timeoutMs, {
        onSpawn: options.onSpawn,
        stdin: run.stdin
    });
}

/*
 * The JSON object out of whatever a CLI wrote around it, from the first `{` to the last `}`: a
 * print-mode run still prints a line about the session, and a model still opens with a word now and
 * then. Undefined when that is no JSON.
 */
export function jsonObjectIn(output: string): unknown {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }
    try {
        return JSON.parse(output.slice(start, end + 1));
    } catch {
        return undefined;
    }
}
