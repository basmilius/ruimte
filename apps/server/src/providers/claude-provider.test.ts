import { expect, test } from 'bun:test';
import { CLAUDE_ALLOW_CONTEXT, claudeProvider } from './claude-provider.ts';

test('every mode of a chat lets ruimte-context through without a prompt', async () => {
    for (const runtimeMode of ['supervised', 'auto-accept-edits', 'auto', 'full-access'] as const) {
        let command: string[] = [];
        const backend = claudeProvider.createBackend(
            {
                command: ['claude'],
                cwd: '/',
                env: {},
                selection: { model: 'claude-sonnet-5', options: {} },
                modelName: 'Sonnet',
                runtimeMode,
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
        expect(command).toContain(CLAUDE_ALLOW_CONTEXT);
    }
});
