import { expect, test } from 'bun:test';
import { claudeProvider } from './claude-provider.ts';
import { terminalCommand } from './launch.ts';

test("a chat and a terminal let Ruimte's MCP tools through without a prompt", async () => {
    let command: string[] = [];
    const backend = claudeProvider.createBackend(
        {
            command: ['claude'],
            cwd: '/',
            env: { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'secret-token' },
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
    expect(command).toContain('--allowedTools=mcp__ruimte__*');
    expect(command.join(' ')).toContain('"Authorization":"Bearer ${RUIMTE_CONTEXT_TOKEN}"');
    expect(command.join(' ')).not.toContain('secret-token');
    expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' })).toBe("claude '--allowedTools=mcp__ruimte' --permission-mode default");
    await backend.dispose();
});
