import { describe, expect, test } from 'bun:test';
import { matchCommandLook, summarizeGroup } from '@adecore/agents-react/chat';
import type { ChatToolItem } from '@ruimte/contracts';
import { RUIMTE_COMMAND_LOOKS, sentByNotify } from '@/chat/ruimte-command-look';

/* A call as its line reads: the label after "Ruimte", the detail, and what else the line ran. */
function line(command: string): [string, string, readonly string[], number] | null {
    const run = matchCommandLook(command, RUIMTE_COMMAND_LOOKS);
    return run === null ? null : [run.match.label, run.detail, run.others, run.more];
}

function call(id: string, command: string): ChatToolItem {
    return {
        id,
        kind: 'tool',
        createdAt: 1,
        turnId: null,
        toolUseId: id,
        name: 'Bash',
        input: { command },
        output: '',
        state: 'done',
        parentToolUseId: null
    } as ChatToolItem;
}

describe('a ruimte-context call', () => {
    test('reads as the part of Ruimte its verb works on, from the word that says what it does', () => {
        expect(line('ruimte-context computer menu "Ruimte Dev" "File > New View" --wait 5')).toEqual([
            'Computer Use',
            'menu "Ruimte Dev" "File > New View" --wait 5',
            [],
            0
        ]);
        expect(line('ruimte-context node new note --view main --title "Open punten" && ruimte-context link new a b --view main')).toEqual([
            'Canvas',
            'node new note --view main --title "Open punten"',
            [],
            1
        ]);
        expect(line('ruimte-context done --result-file /tmp/result.md')).toEqual(['Task', 'done --result-file /tmp/result.md', [], 0]);
        expect(line('ruimte-context alert --text "De build is groen"')).toEqual(['Notification', '--text "De build is groen"', [], 0]);
        expect(line('ruimte-context help computer click')).toEqual(['Help', 'computer click', [], 0]);
        expect(line('NO_COLOR=1 ~/.ruimte/bin/ruimte-context launches read api --tail 80')).toEqual(['Launches', 'read api --tail 80', [], 0]);
        expect(line('sleep 3; ruimte-context computer state "Ruimte Dev" 2>&1 | grep -E x')).toEqual([
            'Computer Use',
            'state "Ruimte Dev"',
            ['sleep', 'grep'],
            0
        ]);
    });

    test('a verb this client does not know reads as Ruimte alone, and no verb as Context', () => {
        expect(line('ruimte-context teleport --to mars')).toEqual(['', 'teleport --to mars', [], 0]);
        expect(line('ruimte-context')).toEqual(['Context', '', [], 0]);
    });

    test('a long prompt is cut so the options after it stay, and SQL is SQL', () => {
        const prompt = 'The tokenizer drops a trailing heredoc marker when the line ends in a comment';
        expect(line(`ruimte-context agent codex --task "Fix the lexer" --prompt "${prompt}" --view Werk`)?.[1]).toBe(
            `codex --task "Fix the lexer" --prompt "${prompt.slice(0, 40)}…" --view Werk`
        );
        const run = matchCommandLook(`ruimte-context database query --connection local --sql "SELECT id FROM users"`, RUIMTE_COMMAND_LOOKS)!;
        expect(run.code.map(({ start, end, language }) => [language, run.detail.slice(start, end)])).toEqual([['sql', 'SELECT id FROM users']]);
    });

    test('only the program itself is Ruimte, never a mention of it', () => {
        expect(line('grep -rn "ruimte-context" apps/server/src/canvas')).toBeNull();
        expect(line('which ruimte-context')).toBeNull();
        expect(line('bun src/main.ts status --port 4211')).toBeNull();
    });

    test('a run of one part reads as using it, and of several parts as using Ruimte', () => {
        expect(summarizeGroup([call('1', 'ruimte-context computer click a'), call('2', 'ruimte-context computer state a')], RUIMTE_COMMAND_LOOKS)).toBe(
            'Used Ruimte Computer Use 2 times'
        );
        expect(summarizeGroup([call('1', 'ruimte-context computer click a'), call('2', 'ruimte-context node list')], RUIMTE_COMMAND_LOOKS)).toBe(
            'Used Ruimte 2 times'
        );
        expect(summarizeGroup([call('1', 'ruimte-context computer click a'), call('2', 'ls')], RUIMTE_COMMAND_LOOKS)).toBe('Ran 2 commands');
    });
});

describe('a notify call as the message it sent', () => {
    const NOTIFY = ['notify', 'chat-b', '--text', 'hello'];

    const sent = (output: string | null, state: 'running' | 'done' | 'error' = 'done', args: readonly string[] = NOTIFY, heredoc: string | null = null) =>
        sentByNotify({ args, heredoc, state, output });

    test('reads how it went from the first line, with the name the target had', () => {
        expect(sent('notified\tchat-b\tnow\tdetail\tLead')).toEqual({ to: 'chat-b', text: 'hello', state: 'delivered', title: 'Lead' });
        expect(sent('notified\tchat-b\twaiting\tdetail')).toEqual({ to: 'chat-b', text: 'hello', state: 'waiting' });
        expect(sent(null, 'running')).toEqual({ to: 'chat-b', text: 'hello', state: 'sending' });
    });

    test('a refusal says why, an unknown one or an error without one only that it failed', () => {
        expect(sent('Exit code 3\nrefused\tnot-an-agent\tmessage', 'error')).toMatchObject({ state: 'failed', reason: 'That runs no agent' });
        expect(sent('refused\tsomething-new\tmessage', 'error')).toEqual({ to: 'chat-b', text: 'hello', state: 'failed' });
        expect(sent('command not found', 'error')).toEqual({ to: 'chat-b', text: 'hello', state: 'failed' });
    });

    test('a finished call that says neither stays a tool line', () => {
        expect(sent('')).toBeNull();
    });

    test('reads the escapes the machine reads, and takes stdin as it is', () => {
        expect(sent('notified\tchat-b\tnow\td', 'done', ['notify', 'chat-b', '--text', 'a\\nb'])?.text).toBe('a\nb');
        expect(sent('notified\tchat-b\tnow\td', 'done', ['notify', 'chat-b', '--text', '-'], 'a\\nb\n')?.text).toBe('a\\nb\n');
        expect(sent('', 'running', ['notify', 'chat-b', '--text', '-'])).toBeNull();
    });

    test('another project is said on the chip, under its id', () => {
        expect(sent('notified\tchat-b\tnow\td', 'done', ['notify', 'chat-b', '--text', 'hi', '--project', 'site'])).toMatchObject({
            title: 'In another project',
            hint: 'site'
        });
        expect(sent('notified\tchat-b\tnow\td\tLead', 'done', ['notify', 'chat-b', '--text=hi', '--project=site'])).toMatchObject({
            title: 'Lead',
            hint: 'site'
        });
    });

    test('anything but one id and its text stays a tool line', () => {
        expect(sent('', 'running', ['notify', '--text', 'hi'])).toBeNull();
        expect(sent('', 'running', ['notify', 'a', 'b', '--text', 'hi'])).toBeNull();
        expect(sent('', 'running', ['notify', 'chat-b'])).toBeNull();
        expect(sent('', 'running', ['notify', 'chat-b', '--text', 'hi', '--view', 'main'])).toBeNull();
        expect(sent('', 'running', ['answer', 'chat-b', '--text', 'hi'])).toBeNull();
    });
});
