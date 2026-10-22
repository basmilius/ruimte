import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import type { VoiceChatCompletion, VoiceChatFollowUp } from '@ruimte/voice';
import { FakeChats, FakeClock } from './voice-fakes.ts';
import { FIRST_TURN_DEADLINE_MS, MAX_FOLLOWED, VoiceFollower, type VoiceFollowActivity } from './voice-follower.ts';

const NAMED = { chat: 'Builder', project: 'Shop' };

let chats: FakeChats;
let clock: FakeClock;
let completions: { followUp: VoiceChatFollowUp; completion: VoiceChatCompletion }[];
let reports: { id: string; chatKey: string; context: string }[];
let activity: VoiceFollowActivity[];
let cancelled: string[];

function follower(): VoiceFollower {
    return new VoiceFollower({
        chats,
        clock,
        delivery: {
            enqueue: (followUp, completion) => completions.push({ followUp, completion }),
            report: (id, chatKey, context) => reports.push({ id, chatKey, context }),
            cancelChat: (chatKey) => cancelled.push(chatKey)
        },
        activity: (entry) => activity.push(entry)
    });
}

function turn(id: string, state: 'running' | 'done' | 'aborted' | 'error'): ChatItem {
    return { id, kind: 'turn', createdAt: 1, turnId: id, state, endedAt: state === 'running' ? null : 2, costUsd: 0 } as ChatItem;
}

function said(turnId: string, text: string): ChatItem {
    return { id: `a-${turnId}`, kind: 'assistant', createdAt: 2, turnId, text, streaming: false, parentToolUseId: null } as ChatItem;
}

function info(status: ChatInfo['status'], activeTurnId: string | null) {
    return { status, activeTurnId };
}

beforeEach(() => {
    chats = new FakeChats();
    clock = new FakeClock();
    completions = [];
    reports = [];
    activity = [];
    cancelled = [];
});

describe('following a prompt', () => {
    test('tells the end of the turn the chat named for the prompt, once, and not of a turn before it', async () => {
        const voice = follower();
        chats.set('chat-1', [turn('t1', 'running')], info('running', 't1'));
        const ticket = voice.expectPrompt('chat-1', NAMED);
        // The prompt queued behind t1, so the chat names a turn of its own for it.
        ticket.bind('t2');
        chats.set('chat-1', [turn('t1', 'done'), said('t1', 'The first one')], info('idle', null));
        expect(completions).toEqual([]);
        chats.set('chat-1', [turn('t1', 'done'), turn('t2', 'running')], info('running', 't2'));
        chats.set('chat-1', [turn('t1', 'done'), turn('t2', 'done'), said('t2', 'Tests pass')], info('idle', null));
        chats.set('chat-1', [turn('t1', 'done'), turn('t2', 'done'), said('t2', 'Tests pass')], info('idle', null), 'info');
        expect(completions).toEqual([
            {
                followUp: { key: 'chat-1', chatId: 'chat-1', chat: 'Builder', project: 'Shop', turnId: 't2' },
                completion: { state: 'done', answer: 'Tests pass' }
            }
        ]);
        expect(voice.size).toBe(0);
    });

    test('a steer joins the running turn, which is the one told when it ends', () => {
        const voice = follower();
        chats.set('chat-1', [turn('t1', 'running')], info('running', 't1'));
        voice.expectPrompt('chat-1', NAMED).bind('t1');
        chats.set('chat-1', [turn('t1', 'aborted')], info('idle', null));
        expect(completions.map((entry) => [entry.followUp.turnId, entry.completion.state])).toEqual([['t1', 'aborted']]);
    });

    test('a turn that ended before the send answered is told as soon as the turn is known', () => {
        const voice = follower();
        const ticket = voice.expectPrompt('chat-1', NAMED);
        chats.set('chat-1', [turn('t1', 'done'), said('t1', 'Quick')], info('idle', null));
        expect(completions).toEqual([]);
        ticket.bind('t1');
        expect(completions.map((entry) => entry.completion)).toEqual([{ state: 'done', answer: 'Quick' }]);
    });

    test('an idle chat is no finished turn, and a delta is no reason to look', () => {
        const voice = follower();
        chats.set('chat-1', [], info('idle', null));
        voice.expectPrompt('chat-1', NAMED).bind('t9');
        chats.set('chat-1', [], info('idle', null), 'info');
        chats.set('chat-1', [turn('t9', 'done')], info('idle', null), 'delta');
        expect(completions).toEqual([]);
        chats.set('chat-1', [turn('t9', 'error')], info('error', null));
        expect(completions.map((entry) => entry.completion.state)).toEqual(['error']);
    });

    test('says each time the turn waits on the person, and then how it ended', () => {
        const voice = follower();
        chats.set('chat-1', [turn('t1', 'running')], info('running', 't1'));
        voice.expectPrompt('chat-1', NAMED).bind('t1');
        const approval = {
            id: 'approval-r1',
            kind: 'approval',
            createdAt: 2,
            turnId: 't1',
            requestId: 'r1',
            toolUseId: null,
            toolName: 'Bash',
            input: { command: 'rm -rf build --token sk-hidden', description: 'Clean the build' },
            description: null,
            canAllowAlways: false,
            decision: 'pending'
        } as ChatItem;
        chats.set('chat-1', [turn('t1', 'running'), approval], info('needs-you', 't1'));
        chats.set('chat-1', [turn('t1', 'running'), approval], info('needs-you', 't1'), 'info');
        expect(reports.map((report) => report.id)).toEqual(['chat-1:t1:wait-1']);
        expect(reports[0]!.context).toContain('approval for Bash: Clean the build');
        expect(reports[0]!.context).not.toContain('sk-hidden');
        chats.set('chat-1', [turn('t1', 'running')], info('running', 't1'));
        chats.set('chat-1', [turn('t1', 'running')], info('needs-you', 't1'));
        expect(reports.map((report) => report.id)).toEqual(['chat-1:t1:wait-1', 'chat-1:t1:wait-2']);
        chats.set('chat-1', [turn('t1', 'done')], info('idle', null));
        expect(completions).toHaveLength(1);
    });

    test('a send that failed follows nothing', () => {
        const voice = follower();
        voice.expectPrompt('chat-1', NAMED).drop();
        expect(voice.size).toBe(0);
    });

    test('eight chats at once are each told by their own turn, in the order they end', () => {
        const voice = follower();
        const ids = Array.from({ length: 8 }, (_, i) => `chat-${i}`);
        for (const [index, chatId] of ids.entries()) {
            chats.set(chatId, [turn(`t${index}`, 'running')], info('running', `t${index}`));
            voice.expectPrompt(chatId, { chat: `Chat ${index}`, project: 'Shop' }).bind(`t${index}`);
        }
        for (const index of [5, 0, 7, 2, 1, 6, 3, 4]) {
            chats.set(ids[index]!, [turn(`t${index}`, 'done'), said(`t${index}`, `Answer ${index}`)], info('idle', null));
        }
        expect(completions.map((entry) => [entry.followUp.chat, entry.followUp.turnId, entry.completion.answer])).toEqual(
            [5, 0, 7, 2, 1, 6, 3, 4].map((index) => [`Chat ${index}`, `t${index}`, `Answer ${index}`])
        );
    });

    test('follows a bounded number of chats, letting the oldest go', () => {
        const voice = follower();
        for (let i = 0; i <= MAX_FOLLOWED; i++) {
            voice.expectPrompt(`chat-${i}`, NAMED).bind(`t${i}`);
        }
        expect(voice.size).toBe(MAX_FOLLOWED);
        chats.set('chat-0', [turn('t0', 'done')], info('idle', null));
        expect(completions).toEqual([]);
    });

    test('a chat Voice cleared is followed no more, and what waited to be told of it goes', () => {
        const voice = follower();
        chats.set('chat-1', [turn('t1', 'running')], info('running', 't1'));
        chats.set('chat-2', [turn('t2', 'running')], info('running', 't2'));
        voice.expectPrompt('chat-1', NAMED).bind('t1');
        voice.expectPrompt('chat-2', NAMED).bind('t2');
        voice.cleared('chat-1');
        expect(cancelled).toEqual(['chat-1']);
        expect(voice.size).toBe(1);
        chats.set('chat-1', [turn('t3', 'done')], info('idle', null));
        chats.set('chat-2', [turn('t2', 'done')], info('idle', null));
        expect(completions.map((entry) => entry.followUp.chatId)).toEqual(['chat-2']);
    });

    test('a stopped follower tells nothing more and listens no more', () => {
        const voice = follower();
        voice.expectPrompt('chat-1', NAMED).bind('t1');
        expect(chats.listening).toBe(1);
        voice.stop();
        expect(chats.listening).toBe(0);
        chats.set('chat-1', [turn('t1', 'done')], info('idle', null));
        expect(completions).toEqual([]);
    });
});

describe('following a start', () => {
    test('tells the chat made, its runtime ready, its first prompt taken, and the end of that first turn', () => {
        const voice = follower();
        const ticket = voice.expectStart();
        ticket.bind('chat-new', { chat: 'Tests', project: 'Shop' });
        expect(activity.map((entry) => entry.label)).toEqual(['Started “Tests”']);
        // The chat is made by the outbox and has no turn yet.
        chats.set('chat-new', [], info('idle', null), 'info');
        chats.set('chat-new', [turn('t1', 'running')], info('running', 't1'));
        chats.set('chat-new', [turn('t1', 'done'), said('t1', 'All green')], info('idle', null));
        expect(activity.map((entry) => [entry.label, entry.status])).toEqual([
            ['Started “Tests”', 'completed'],
            ['“Tests” is running', 'completed'],
            ['“Tests” took its first prompt', 'completed'],
            ['“Tests” finished', 'completed']
        ]);
        expect(completions.map((entry) => [entry.followUp.chatId, entry.followUp.turnId, entry.completion.answer])).toEqual([['chat-new', 't1', 'All green']]);
        expect(clock.pending).toBe(0);
    });

    test('a first turn that does not start in time is told as not confirmed, never as done', () => {
        const voice = follower();
        voice.expectStart().bind('chat-new', { chat: 'Tests', project: 'Shop' });
        chats.set('chat-new', [], info('idle', null), 'info');
        clock.advance(FIRST_TURN_DEADLINE_MS - 1);
        expect(reports).toEqual([]);
        clock.advance(1);
        expect(reports.map((report) => report.id)).toEqual(['chat-new:unconfirmed']);
        expect(reports[0]!.context).toContain('was made, but its first turn did not start');
        expect(activity.at(-1)).toMatchObject({ status: 'failed' });
        // A turn that comes after that is no longer followed.
        chats.set('chat-new', [turn('t1', 'done')], info('idle', null));
        expect(completions).toEqual([]);
    });

    test('a start or a send that answers after the session ended follows nothing and sets no clock', () => {
        const voice = follower();
        chats.set('chat-new', [turn('t1', 'done'), said('t1', 'All green')], info('idle', null));
        chats.set('chat-1', [turn('t2', 'done'), said('t2', 'Done')], info('idle', null));
        const start = voice.expectStart();
        const prompt = voice.expectPrompt('chat-1', NAMED);
        voice.stop();
        start.bind('chat-new', NAMED);
        prompt.bind('t2');
        // A ticket taken after the end is as empty.
        voice.expectPrompt('chat-1', NAMED).bind('t2');
        voice.expectStart().bind('chat-new', NAMED);
        expect([voice.size, clock.pending, activity, completions, reports]).toEqual([0, 0, [], [], []]);
    });

    test('a start that failed follows nothing and sets no clock', () => {
        const voice = follower();
        const ticket = voice.expectStart();
        ticket.drop();
        ticket.bind('chat-new', NAMED);
        expect([voice.size, clock.pending, activity]).toEqual([0, 0, []]);
    });
});
