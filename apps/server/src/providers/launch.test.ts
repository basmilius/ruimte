import { describe, expect, test } from 'bun:test';
import { freshCommand, resumeCommand, resumeOrFreshCommand, terminalCommand } from './launch.ts';

describe('terminalCommand', () => {
    test('starts a CLI in the runtime mode the node asked for', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' })).toBe('claude');
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'auto-accept-edits' })).toBe('claude --permission-mode acceptEdits');
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'full-access' })).toBe('claude --permission-mode bypassPermissions');
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'auto' })).toBe('codex --ask-for-approval on-request --sandbox workspace-write');
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'full-access' })).toBe('codex --ask-for-approval never --sandbox danger-full-access');
        expect(terminalCommand({ kind: 'gemini', runtimeMode: 'auto-accept-edits' })).toBe('gemini --approval-mode auto_edit');
        expect(terminalCommand({ kind: 'gemini', runtimeMode: 'full-access' })).toBe('gemini --approval-mode yolo');
        expect(terminalCommand({ kind: 'copilot', runtimeMode: 'full-access' })).toBe('copilot');
    });

    test('full access is what a launch without a mode gets', () => {
        expect(terminalCommand({ kind: 'claude' })).toBe('claude --permission-mode bypassPermissions');
    });

    test('a model reaches the CLIs that take one, quoted', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised', model: 'claude-opus-5' })).toBe("claude --model 'claude-opus-5'");
        expect(terminalCommand({ kind: 'gemini', runtimeMode: 'supervised', model: 'gemini-3-pro' })).toBe('gemini');
    });

    test("a first prompt rides on the line as the CLI's own prompt argument, quoted", () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised' }, 'say hello')).toBe("claude 'say hello'");
        expect(terminalCommand({ kind: 'codex', runtimeMode: 'supervised' }, "it's here")).toBe(
            "codex --ask-for-approval on-request --sandbox workspace-write 'it'\\''s here'"
        );
        expect(terminalCommand({ kind: 'gemini', runtimeMode: 'supervised' }, 'go')).toBe("gemini '-i' 'go'");
        expect(terminalCommand({ kind: 'copilot', runtimeMode: 'supervised' }, 'go')).toBe("copilot '-p' 'go'");
    });

    test('a resume never carries a first prompt: the session it picks up has its own history', () => {
        expect(terminalCommand({ kind: 'claude', resume: 'abc-123' }, 'say hello')).toBe("claude --resume 'abc-123'");
    });

    test('a resume continues that session and ignores the mode', () => {
        expect(terminalCommand({ kind: 'claude', runtimeMode: 'supervised', resume: 'abc-123' })).toBe("claude --resume 'abc-123'");
        expect(terminalCommand({ kind: 'codex', resume: 'abc-123' })).toBe("codex resume 'abc-123'");
        expect(terminalCommand({ kind: 'copilot', resume: 'abc-123' })).toBe("copilot --resume='abc-123'");
    });
});

describe('resumeCommand', () => {
    test('quotes the id for the shell', () => {
        expect(resumeCommand('claude', 'abc-123')).toBe("claude --resume 'abc-123'");
        expect(resumeCommand('codex', "a'b")).toBe("codex resume 'a'\\''b'");
    });
});

describe('freshCommand', () => {
    test('drops the resume of a launch and keeps the rest of it', () => {
        expect(freshCommand({ kind: 'claude', runtimeMode: 'supervised', model: 'claude-opus-5', resume: 'abc-123' })).toBe("claude --model 'claude-opus-5'");
    });
});

describe('resumeOrFreshCommand', () => {
    test('is one line the shell falls back in', () => {
        expect(resumeOrFreshCommand({ kind: 'claude', runtimeMode: 'full-access' }, 'abc-123')).toBe(
            "claude --resume 'abc-123' || claude --permission-mode bypassPermissions"
        );
    });
});
