import { expect, test } from 'bun:test';
import { CLAUDE_ALLOW_CONTEXT, claudeProvider } from './claude-provider.ts';

// The rule as Claude Code reads it; the terminal launch line takes the same constant.
const ALLOW_CONTEXT = '--allowedTools=Bash(ruimte-context *)';

test('a chat and a terminal let ruimte-context through without a prompt', async () => {
    let command: string[] = [];
    const backend = claudeProvider.createBackend(
        {
            command: ['claude'],
            cwd: '/',
            env: {},
            selection: { model: 'claude-sonnet-5', options: {} },
            modelName: 'Sonnet',
            runtimeMode: 'supervised',
            resume: null,
            generation: 1,
            instructions: null,
            resumeNote: null,
            spawn: (options) => {
                command = options.command;
                return {
                    pid: 1,
                    stdin: { write: () => 0, flush: () => 0, end: () => 0 },
                    stdout: new ReadableStream<Uint8Array>(),
                    kill: () => undefined
                };
            }
        },
        { onEvent: () => undefined }
    );
    await backend.start();
    expect(command).toContain(ALLOW_CONTEXT);
    expect(CLAUDE_ALLOW_CONTEXT).toBe(ALLOW_CONTEXT);
});
