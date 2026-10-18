import { describe, expect, test } from 'bun:test';
import { chatWaits, settledPrompt, terminalWaits, VoiceSessionWatch, waitingPrompt, type VoiceWatchedSession } from '@/voice/session-watch';

const terminal: VoiceWatchedSession = { key: 'local:agent', kind: 'terminal', name: 'Claude', project: 'Atlas' };
const chat: VoiceWatchedSession = { key: 'local:chat', kind: 'chat', name: 'Research', project: 'Atlas' };

describe('VoiceSessionWatch', () => {
    test('tells a finished turn once, and only after one ran', () => {
        const watch = new VoiceSessionWatch();
        watch.watch(terminal, 'idle');
        expect(watch.observe(terminal.key, 'idle')).toBeNull();
        expect(watch.observe(terminal.key, 'running')).toBeNull();
        expect(watch.observe(terminal.key, 'idle')).toBe('done');
        expect(watch.sessions()).toEqual([]);
        expect(watch.observe(terminal.key, 'running')).toBeNull();
    });

    test('tells each wait for the user and keeps following the session after it', () => {
        const watch = new VoiceSessionWatch();
        watch.watch(chat, 'running');
        expect(watch.observe(chat.key, 'needs-you')).toBe('needs-you');
        expect(watch.observe(chat.key, 'needs-you')).toBeNull();
        expect(watch.observe(chat.key, 'running')).toBeNull();
        expect(watch.observe(chat.key, 'needs-you')).toBe('needs-you');
        expect(watch.sessions()).toEqual([chat]);
    });

    test('an error or an exit ends the watch even before a turn ran', () => {
        const watch = new VoiceSessionWatch();
        watch.watch(terminal, 'idle');
        expect(watch.observe(terminal.key, 'exited')).toBe('exited');
        watch.watch(terminal, 'running');
        expect(watch.observe(terminal.key, 'error')).toBe('error');
        expect(watch.sessions()).toEqual([]);
    });

    test('a status this window does not know changes nothing', () => {
        const watch = new VoiceSessionWatch();
        watch.watch(terminal, 'running');
        expect(watch.observe(terminal.key, undefined)).toBeNull();
        expect(watch.observe(terminal.key, 'idle')).toBe('done');
    });

    test('a session it does not watch, or no longer watches, says nothing', () => {
        const watch = new VoiceSessionWatch();
        expect(watch.observe(terminal.key, 'needs-you')).toBeNull();
        watch.watch(terminal, 'running');
        watch.forget(terminal.key);
        expect(watch.observe(terminal.key, 'idle')).toBeNull();
    });
});

describe('what Voice is told', () => {
    test('a terminal names its approvals and questions', () => {
        const waits = terminalWaits([
            { id: '1', source: 'hook', kind: 'approval', toolName: 'Bash', title: null, text: 'rm -rf build', createdAt: 1 },
            { id: '2', source: 'hook', kind: 'question', toolName: 'AskUserQuestion', title: null, text: 'Which branch?', createdAt: 2 }
        ]);
        expect(waits).toEqual(['approval for Bash: rm -rf build', 'question: Which branch?']);
        expect(waitingPrompt(terminal, waits)).toBe(
            'Ruimte status event. The terminal agent “Claude” you set to work in project Atlas now waits for the user. It waits on:\napproval for Bash: rm -rf build\nquestion: Which branch?\nEnd of quoted request.'
        );
    });

    test('a long request is cut short so the event stays small', () => {
        const waits = terminalWaits([{ id: '1', source: 'hook', kind: 'question', toolName: 'Ask', title: null, text: 'x'.repeat(2000), createdAt: 1 }]);
        expect(waits.join('').length).toBe(600);
    });

    test('a chat names only the requests that still wait', () => {
        const items = {
            done: { id: 'done', kind: 'approval', decision: 'allow', toolName: 'Edit', description: null },
            open: { id: 'open', kind: 'approval', decision: 'pending', toolName: 'Bash', description: 'Run the tests' },
            ask: { id: 'ask', kind: 'question', state: 'pending', questions: [{ question: 'Which file?' }] }
        };
        expect(chatWaits({ items: items as never, order: ['done', 'open', 'ask'] })).toEqual(['approval for Bash: Run the tests', 'question: Which file?']);
    });

    test('a chat whose thread is not here points at chat.inspect', () => {
        expect(waitingPrompt(chat, chatWaits(undefined))).toBe(
            'Ruimte status event. The AI Chat “Research” you set to work in project Atlas now waits for the user. What it waits on is not known here; chat.inspect reads it.'
        );
    });

    test('a finished terminal agent says its answer is not included', () => {
        expect(settledPrompt(terminal, 'done')).toContain('finished its turn and is idle. Its answer is in its terminal and is not included here');
    });
});
