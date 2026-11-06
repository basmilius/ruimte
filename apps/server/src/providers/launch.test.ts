import { describe, expect, test } from 'bun:test';
import type { CliMcpServer } from '@adecore/agents/providers';
import { freshCommand, hookTellsTools, probeCodexNoDaemon, resumeCommand, noteOnLine, resumeOrFreshCommand, terminalCommand } from './launch.ts';

// How the launch line quotes the flag that lets Ruimte's MCP tools through.
const ALLOW = `'--allowedTools=mcp__ruimte'`;
const COPILOT_ALLOW = `'--allow-tool=ruimte'`;
const MCP: CliMcpServer = { name: 'ruimte', url: 'http://127.0.0.1:4210/mcp', tokenVariable: 'RUIMTE_HOOK_TOKEN' };

/* What a POSIX shell hands the CLI for one quoted word of a line. */
function unquoted(word: string): string {
    return word.slice(1, -1).replaceAll(`'\\''`, "'");
}

describe('terminalCommand', () => {
    test('a chat-only provider cannot launch its helper in a terminal, with or without a prompt or resume id', () => {
        expect(() => terminalCommand({ kind: 'nanogpt' })).toThrow('NanoGPT is only available as a chat');
        expect(() => terminalCommand({ kind: 'nanogpt' }, 'hello')).toThrow('NanoGPT is only available as a chat');
        expect(() => terminalCommand({ kind: 'nanogpt', resume: 'stored' })).toThrow('NanoGPT is only available as a chat');
    });

    test('starts a CLI in the runtime mode the node asked for', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' })).toBe(`claude ${ALLOW} --permission-mode default`);
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'auto-accept-edits' })).toBe(`claude ${ALLOW} --permission-mode acceptEdits`);
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'full-access' })).toBe(`claude ${ALLOW} --permission-mode bypassPermissions`);
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' })).toBe('codex --ask-for-approval on-request --sandbox workspace-write');
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'full-access' })).toBe('codex --ask-for-approval never --sandbox danger-full-access');
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'supervised' })).toBe('agy');
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'auto-accept-edits' })).toBe('agy --mode=accept-edits');
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'auto' })).toBe('agy --mode=accept-edits');
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'full-access' })).toBe('agy --dangerously-skip-permissions');
        expect(terminalCommand({ kind: 'copilot', runtimeMode: 'full-access' })).toBe(`copilot ${COPILOT_ALLOW}`);
    });

    test('full access is what a launch without a mode gets', () => {
        expect(terminalCommand({ kind: 'claude' })).toBe(`claude ${ALLOW} --permission-mode bypassPermissions`);
    });

    test('a model reaches the CLIs that take one, quoted', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised', model: 'claude-opus-5' })).toBe(
            `claude ${ALLOW} --permission-mode default --model 'claude-opus-5'`
        );
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'supervised', model: 'some-model' })).toBe('agy');
    });

    test("a first prompt rides on the line as the CLI's own prompt argument, quoted", () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' }, 'say hello')).toBe(`claude ${ALLOW} --permission-mode default 'say hello'`);
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'supervised' }, "it's here")).toBe(
            "codex --ask-for-approval on-request --sandbox workspace-write 'it'\\''s here'"
        );
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'supervised' }, 'go')).toBe("agy '-i' 'go'");
        expect(terminalCommand({ kind: 'copilot', runtimeMode: 'supervised' }, 'go')).toBe(`copilot ${COPILOT_ALLOW} '-i' 'go'`);
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised' }, 'go')).toBe(`grok --permission-mode default 'go'`);
    });

    test("Claude Code, Codex and Copilot load Ruimte's MCP server on every line, fresh or resumed, with the token left in the environment", () => {
        const claude = terminalCommand({ kind: 'claude', runtimeMode: 'supervised' }, undefined, undefined, MCP);
        const config = unquoted(/^claude ('--mcp-config=[^']*') /.exec(claude)![1]!);
        expect(JSON.parse(config.slice('--mcp-config='.length))).toEqual({
            mcpServers: { ruimte: { type: 'http', url: MCP.url, headers: { Authorization: 'Bearer ${RUIMTE_HOOK_TOKEN}' } } }
        });
        expect(claude).toEndWith(`${ALLOW} --permission-mode default`);
        expect(resumeCommand({ kind: 'claude' }, 'abc', MCP)).toStartWith(`claude '--mcp-config=`);
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' }, undefined, undefined, MCP)).toBe(
            `codex -c 'mcp_servers.ruimte.url="${MCP.url}"' -c 'mcp_servers.ruimte.bearer_token_env_var="RUIMTE_HOOK_TOKEN"' -c 'mcp_servers.ruimte.default_tools_approval_mode="approve"' --ask-for-approval on-request --sandbox workspace-write`
        );
        expect(resumeCommand({ kind: 'codex' }, 'abc', MCP)).toStartWith(`codex resume -c 'mcp_servers.ruimte.url=`);
        expect(resumeCommand({ kind: 'copilot' }, 'abc', MCP)).toMatch(/^copilot '--additional-mcp-config=\{.*\}' '--allow-tool=ruimte' --resume='abc'$/);
        // Grok and Antigravity take no MCP server on their line.
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised' }, undefined, undefined, MCP)).toBe('grok --permission-mode default');
        expect(terminalCommand({ kind: 'antigravity', runtimeMode: 'supervised' }, undefined, undefined, MCP)).toBe('agy');
    });

    test('a Grok terminal starts in the permission mode of its runtime mode, and resumes in it', () => {
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'auto-accept-edits' })).toBe(`grok --permission-mode acceptEdits`);
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'auto' })).toBe(`grok --permission-mode auto`);
        expect(terminalCommand({ kind: 'grok' })).toBe(`grok --permission-mode bypassPermissions`);
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised', resume: 'abc' })).toBe(`grok --permission-mode default --resume 'abc'`);
    });

    test('a kind this daemon does not offer starts nothing', () => {
        expect(() => terminalCommand({ kind: 'future-cli', runtimeMode: 'supervised' })).toThrow();
    });

    test('a Codex launch carries the note as developer instructions, one shell word holding a TOML string', () => {
        const note = 'Run `ruimte-context help`; it\'s "quoted"\nand \\ kept';
        const line = terminalCommand({ kind: 'codex', runtimeMode: 'supervised' }, 'go', note);
        expect(line).toBe(
            `codex --ask-for-approval on-request --sandbox workspace-write -c 'developer_instructions="Run \`ruimte-context help\`; it'\\''s \\"quoted\\"\\nand \\\\ kept"' 'go'`
        );
        const word = line.split(' -c ')[1]!.split(" 'go'")[0]!;
        expect(Bun.TOML.parse(unquoted(word))).toEqual({ developer_instructions: note });
    });

    test('only Codex takes the note on its line, and only on a fresh launch', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' }, undefined, 'note')).toBe(`claude ${ALLOW} --permission-mode default`);
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'supervised', resume: 'abc-123' }, undefined, 'note')).toBe(
            "codex resume --ask-for-approval on-request --sandbox workspace-write 'abc-123'"
        );
        expect(resumeOrFreshCommand({ kind: 'codex', runtimeMode: 'supervised' }, 'abc-123', 'note')).toBe(
            `codex resume --ask-for-approval on-request --sandbox workspace-write 'abc-123' || codex --ask-for-approval on-request --sandbox workspace-write -c 'developer_instructions="note"'`
        );
    });

    test('keeps Codex out of its shared background server once the installed Codex offers the flag', async () => {
        await probeCodexNoDaemon(async () => '  --no-daemon  Run without the shared background server');
        try {
            expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' })).toBe('codex --no-daemon --ask-for-approval on-request --sandbox workspace-write');
            expect(resumeCommand({ kind: 'codex', runtimeMode: 'auto' }, 'abc-123')).toBe(
                "codex resume --no-daemon --ask-for-approval on-request --sandbox workspace-write 'abc-123'"
            );
            expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' })).toBe(`claude ${ALLOW} --permission-mode default`);
        } finally {
            await probeCodexNoDaemon(async () => '');
        }
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' })).toBe('codex --ask-for-approval on-request --sandbox workspace-write');
    });

    test('a Codex that never answers its help is stopped and counts as one without the flag', async () => {
        let stopped = false;
        await probeCodexNoDaemon(
            (signal) =>
                new Promise<string>(() => {
                    signal.addEventListener('abort', () => {
                        stopped = true;
                    });
                }),
            0
        );
        expect(stopped).toBe(true);
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' })).toBe('codex --ask-for-approval on-request --sandbox workspace-write');
    });

    test('says which launches carried the note, so their start hook leaves it out', () => {
        expect(noteOnLine('codex', { kind: 'codex' })).toBe(true);
        expect(noteOnLine('claude', { kind: 'claude' })).toBe(false);
        expect(noteOnLine('codex', null)).toBe(false);
    });

    test('a start hook tells the tools only to a CLI Ruimte launched without the note on its line', () => {
        expect(hookTellsTools('claude', { kind: 'claude' })).toBe(true);
        expect(hookTellsTools('claude', { kind: 'claude', resume: 'abc-123' })).toBe(true);
        expect(hookTellsTools('codex', { kind: 'codex', resume: 'thread-1' })).toBe(true);
        expect(hookTellsTools('codex', { kind: 'codex' })).toBe(false);
        // Typed by hand in a shell: no launch, or a launch of another CLI, and no MCP server on its line.
        expect(hookTellsTools('claude', undefined)).toBe(false);
        expect(hookTellsTools('claude', null)).toBe(false);
        expect(hookTellsTools('claude', { kind: 'codex' })).toBe(false);
    });

    test('a resumed Codex carries no note on its line, so its start hook tells it the tools', () => {
        expect(noteOnLine('codex', { kind: 'codex', resume: 'thread-1' })).toBe(false);
        expect(resumeCommand({ kind: 'codex', resume: 'thread-1' }, 'thread-1')).not.toContain('developer_instructions');
    });

    test('a resume never carries a first prompt: the session it picks up has its own history', () => {
        expect(terminalCommand({ kind: 'claude', resume: 'abc-123' }, 'say hello')).toBe(`claude ${ALLOW} --resume 'abc-123'`);
    });

    test('a resume continues that session in the mode the node asked for', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised', resume: 'abc-123' })).toBe(
            `claude ${ALLOW} --permission-mode default --resume 'abc-123'`
        );
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'auto-accept-edits', resume: 'abc-123' })).toBe(
            `claude ${ALLOW} --permission-mode acceptEdits --resume 'abc-123'`
        );
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'full-access', resume: 'abc-123' })).toBe(
            "codex resume --ask-for-approval never --sandbox danger-full-access 'abc-123'"
        );
        expect(terminalCommand({ kind: 'copilot', resume: 'abc-123' })).toBe(`copilot ${COPILOT_ALLOW} --resume='abc-123'`);
    });
});

describe('resumeCommand', () => {
    test('quotes the id for the shell', () => {
        expect(resumeCommand({ kind: 'claude' }, 'abc-123')).toBe(`claude ${ALLOW} --resume 'abc-123'`);
        expect(resumeCommand({ kind: 'codex' }, "a'b")).toBe("codex resume 'a'\\''b'");
    });

    test('carries the mode and the model of the node, so a resumed CLI comes back the way it started', () => {
        expect(resumeCommand({ kind: 'claude', runtimeMode: 'auto-accept-edits', model: 'claude-opus-5' }, 'abc-123')).toBe(
            `claude ${ALLOW} --permission-mode acceptEdits --model 'claude-opus-5' --resume 'abc-123'`
        );
        expect(resumeCommand({ kind: 'codex', runtimeMode: 'full-access' }, 'abc-123')).toBe(
            "codex resume --ask-for-approval never --sandbox danger-full-access 'abc-123'"
        );
    });

    /* A launch with no mode is a CLI somebody started by hand, which nobody chose a mode for; putting
       the fresh default on that line would hand it full access it was never asked to have. */
    test('a launch that names no mode adds no mode flag', () => {
        expect(resumeCommand({ kind: 'claude' }, 'abc-123')).toBe(`claude ${ALLOW} --resume 'abc-123'`);
        expect(resumeCommand({ kind: 'antigravity' }, 'abc-123')).toBe("agy --conversation 'abc-123'");
        expect(resumeCommand({ kind: 'antigravity', runtimeMode: 'full-access' }, 'abc-123')).toBe(
            "agy --dangerously-skip-permissions --conversation 'abc-123'"
        );
    });
});

describe('freshCommand', () => {
    test('drops the resume of a launch and keeps the rest of it', () => {
        expect(freshCommand({ kind: 'claude', runtimeMode: 'supervised', model: 'claude-opus-5', resume: 'abc-123' })).toBe(
            `claude ${ALLOW} --permission-mode default --model 'claude-opus-5'`
        );
    });
});

describe('resumeOrFreshCommand', () => {
    test('is one line the shell falls back in', () => {
        expect(resumeOrFreshCommand({ kind: 'claude', runtimeMode: 'full-access' }, 'abc-123')).toBe(
            `claude ${ALLOW} --permission-mode bypassPermissions --resume 'abc-123' || claude ${ALLOW} --permission-mode bypassPermissions`
        );
    });
});
