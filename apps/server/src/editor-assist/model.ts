import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CodedError } from '@adecore/agents';
import { ChatChild, type SpawnChatProcess } from '@adecore/agents/chat';
import { cliExecutable } from '@adecore/agents/providers';
import {
    ANSWER_TIMEOUT_MS,
    EDITOR_ASSIST_INSTRUCTIONS,
    type EditorAssistAgent,
    type EditorAssistGenerateResult,
    type EditorAssistPurpose,
    type EditorAssistStatusResult
} from '@ruimte/contracts';
import { oneShotRun } from '../git/one-shot.ts';
import { assistEnvironment, selectAssistAgent, type AssistProviders } from './selection.ts';

interface EditorAssistModelOptions extends AssistProviders {
    home: string;
    spawn?: SpawnChatProcess;
    env?: Record<string, string | undefined>;
}

export interface EditorAssistRequest {
    readonly purpose: EditorAssistPurpose;
    readonly prompt: string;
    readonly agent?: EditorAssistAgent | null;
    readonly onText?: (text: string) => void;
}

const MAX_PENDING = 4;
const MAX_ANSWER_LENGTH = 64_000;

/* One print-mode CLI per request, in an empty folder with no project configuration or chat context. */
export class EditorAssistModel {
    private readonly options: EditorAssistModelOptions;
    private readonly running = new Set<AbortController>();
    private disposed = false;

    constructor(options: EditorAssistModelOptions) {
        this.options = options;
    }

    async status(agent?: EditorAssistAgent | null): Promise<EditorAssistStatusResult> {
        try {
            const { provider, model } = await selectAssistAgent(this.options, agent);

            return { available: true, provider: provider.kind as EditorAssistAgent['provider'], model, modelName: provider.catalog.nameOf(model) };
        } catch (error) {
            return { available: false, reason: error instanceof Error ? error.message : 'The editor model is unavailable.' };
        }
    }

    async generate(request: EditorAssistRequest, signal?: AbortSignal): Promise<EditorAssistGenerateResult> {
        if (signal?.aborted) {
            return { state: 'aborted', text: '' };
        }

        if (this.disposed) {
            throw new CodedError('unavailable', 'The machine is stopping.');
        }

        if (this.running.size >= MAX_PENDING) {
            throw new CodedError('busy', 'The editor model is busy with other requests.');
        }

        const controller = new AbortController();
        this.running.add(controller);
        const abort = (): void => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let child: ChatChild | null = null;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, ANSWER_TIMEOUT_MS);

        try {
            const { provider, model, account } = await selectAssistAgent(this.options, request.agent);
            const cwd = join(this.options.home, 'editor-assist');
            await mkdir(cwd, { recursive: true });

            if (controller.signal.aborted) {
                return this.aborted(timedOut);
            }

            const prompt = `${EDITOR_ASSIST_INSTRUCTIONS[request.purpose]}\nDo not use tools, read files or run commands. Answer using only the following text.\n\n${request.prompt}`;
            const run = oneShotRun(provider, prompt);

            if (run === null) {
                throw new CodedError('unavailable', `${provider.name} cannot answer an editor request.`);
            }

            const args = provider.leanOneShotArgs?.(run.args, model) ?? [...run.args, '--model', model];

            const env = assistEnvironment(this.options.accounts, { provider, account }, this.options.env ?? process.env);
            let exit!: (code: number | null) => void;
            const exited = new Promise<number | null>((resolve) => {
                exit = resolve;
            });
            child = new ChatChild({
                command: [cliExecutable(provider), ...args],
                cwd,
                env,
                ...(this.options.spawn === undefined ? {} : { spawn: this.options.spawn }),
                onExit: (code) => exit(code)
            });
            const activeChild = child;
            const cancelled = new Promise<EditorAssistGenerateResult>((resolve) => {
                controller.signal.addEventListener(
                    'abort',
                    () => {
                        void activeChild.end();
                        resolve({ state: 'aborted', text: '' });
                    },
                    { once: true }
                );
            });
            const output = this.read(activeChild, request.onText);
            child.process.stdin.write(run.stdin ?? '');
            child.process.stdin.end();
            const result = await Promise.race([
                Promise.all([output, exited]).then(([text, code]): EditorAssistGenerateResult => {
                    if (code !== 0) {
                        throw new CodedError('failed', `${provider.name} could not answer the editor request. Check its sign-in and model in Settings.`);
                    }

                    return { state: 'done', text: text.trim() };
                }),
                cancelled
            ]);

            return controller.signal.aborted ? this.aborted(timedOut) : result;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            await child?.end();
            this.running.delete(controller);
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;

        for (const controller of this.running) {
            controller.abort();
        }
    }

    private aborted(timedOut: boolean): EditorAssistGenerateResult {
        if (timedOut) {
            throw new CodedError('failed', `The editor model did not answer within ${ANSWER_TIMEOUT_MS / 1000} seconds.`);
        }

        return { state: 'aborted', text: '' };
    }

    private async read(child: ChatChild, onText?: (text: string) => void): Promise<string> {
        const decoder = new TextDecoder();
        let text = '';

        for await (const chunk of child.process.stdout) {
            text += decoder.decode(chunk, { stream: true });

            if (text.length > MAX_ANSWER_LENGTH) {
                throw new CodedError('failed', 'The editor model returned too much text.');
            }

            onText?.(text);
        }

        return text + decoder.decode();
    }
}
