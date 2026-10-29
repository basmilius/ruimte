import { describe, expect, test } from 'bun:test';
import { COPILOT_ALLOW_CONTEXT, GROK_ALLOW_CONTEXT } from './acp-providers.ts';
import { CLAUDE_ALLOW_CONTEXT } from './claude-provider.ts';
import { freshCommand, probeCodexNoDaemon, resumeCommand, resumeOrFreshCommand, takesNoteOnLine, terminalCommand } from './launch.ts';

// How the launch line quotes the flag that lets ruimte-context through.
const ALLOW = `'${CLAUDE_ALLOW_CONTEXT}'`;
const GROK_ALLOW = `'${GROK_ALLOW_CONTEXT}'`;
const COPILOT_ALLOW = `'${COPILOT_ALLOW_CONTEXT}'`;

describe('terminalCommand', () => {
    test('a chat-only provider cannot launch its helper in a terminal, with or without a prompt or resume id', () => {
        expect(() => terminalCommand({ kind: 'apple' })).toThrow('Apple Foundation Models is only available as a chat');
        expect(() => terminalCommand({ kind: 'apple' }, 'hello')).toThrow('Apple Foundation Models is only available as a chat');
        expect(() => terminalCommand({ kind: 'apple', resume: 'stored' })).toThrow('Apple Foundation Models is only available as a chat');
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
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised' }, 'go')).toBe(`grok ${GROK_ALLOW} --permission-mode default 'go'`);
    });

    test('a Grok or Copilot terminal lets ruimte-context through in every mode, fresh or resumed', () => {
        expect(GROK_ALLOW).toBe("'--allow=Bash(ruimte-context *)'");
        expect(COPILOT_ALLOW).toBe("'--allow-tool=shell(ruimte-context:*)'");
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised' })).toBe(`grok ${GROK_ALLOW} --permission-mode default`);
        expect(terminalCommand({ kind: 'copilot', runtimeMode: 'supervised' })).toBe(`copilot ${COPILOT_ALLOW}`);
        expect(resumeCommand({ kind: 'grok' }, 'abc')).toBe(`grok ${GROK_ALLOW} --resume 'abc'`);
        expect(resumeCommand({ kind: 'copilot' }, 'abc')).toBe(`copilot ${COPILOT_ALLOW} --resume='abc'`);
    });

    test('a Grok terminal starts in the permission mode of its runtime mode, and resumes in it', () => {
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'auto-accept-edits' })).toBe(`grok ${GROK_ALLOW} --permission-mode acceptEdits`);
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'auto' })).toBe(`grok ${GROK_ALLOW} --permission-mode auto`);
        expect(terminalCommand({ kind: 'grok' })).toBe(`grok ${GROK_ALLOW} --permission-mode bypassPermissions`);
        expect(terminalCommand({ kind: 'grok', runtimeMode: 'supervised', resume: 'abc' })).toBe(`grok ${GROK_ALLOW} --permission-mode default --resume 'abc'`);
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
        // What a POSIX shell hands the CLI: the quotes gone and each '\'' an apostrophe again.
        const argument = word.slice(1, -1).replaceAll(`'\\''`, "'");
        expect(Bun.TOML.parse(argument)).toEqual({ developer_instructions: note });
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

    test('says which kinds carry the note, so their start hook leaves it out', () => {
        expect(takesNoteOnLine('codex')).toBe(true);
        expect(takesNoteOnLine('claude')).toBe(false);
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
