import { describe, expect, test } from 'bun:test';
import { completionPrompt, type VoiceChatFollowUp } from '@/voice/chat-follow-up';
import { VoiceCompletionDelivery } from '@/voice/completion-delivery';
import type { LiveEvent } from '@/voice/live-session';

const followUp: VoiceChatFollowUp = { key: 'remote:chat', chat: 'Research', project: 'Atlas', turnId: 'turn-1' };
const completion = { state: 'done' as const, answer: 'The report is ready.' };
const ack = (event: LiveEvent): LiveEvent => ({
    type: event.type === 'session.thinking.append' ? 'session.thinking.appended' : 'session.commentary.appended',
    client_event_id: event.event_id
});

function setup() {
    const sent: LiveEvent[] = [];
    const delivery = new VoiceCompletionDelivery((event) => {
        sent.push(event);
        return true;
    });
    const drain = () => {
        for (let index = 0; index < sent.length; index++) {
            delivery.handle(ack(sent[index]!));
        }
    };
    return { delivery, sent, drain };
}

describe('AI Chat completion delivery to GPT-Live', () => {
    test('automatically requests speech after the full result has arrived, without another backend call', () => {
        const { delivery, sent, drain } = setup();
        delivery.enqueue(followUp, completion);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.type).toBe('session.thinking.append');
        drain();
        expect(sent.at(-1)).toMatchObject({ type: 'session.commentary.append', delegation_id: null });
        expect(sent.at(-1)!.content).toContain('Do not wait for another user message');
        expect(sent.some((event) => event.type === 'response.create')).toBe(false);
        expect(sent.filter((event) => event.type === 'session.commentary.append')).toHaveLength(1);
    });

    test('long multilingual answers are split below the append limit without losing text', () => {
        const { delivery, sent, drain } = setup();
        const result = { state: 'done' as const, answer: 'Antwoord 日本語 🎙️ '.repeat(300) };
        delivery.enqueue(followUp, result);
        drain();
        expect(sent.every((event) => new TextEncoder().encode(String(event.content)).length <= 480)).toBe(true);
        const context = sent
            .filter((event) => event.type === 'session.thinking.append')
            .map((event) => event.content)
            .join('');
        expect(context).toBe(completionPrompt(followUp, result));
        expect(sent.filter((event) => event.type === 'session.commentary.append')).toHaveLength(1);
    });

    test('unrelated acknowledgments cannot announce a partially delivered result', () => {
        const { delivery, sent } = setup();
        delivery.enqueue(followUp, completion);
        delivery.handle({ type: 'session.thinking.appended', client_event_id: 'workspace-context' });
        delivery.handle({ type: 'session.commentary.appended', client_event_id: sent[0]!.event_id });
        expect(sent).toHaveLength(1);
    });

    test('a temporarily unavailable channel does not discard the result', () => {
        let ready = false;
        const sent: LiveEvent[] = [];
        const delivery = new VoiceCompletionDelivery((event) => {
            if (!ready) {
                return false;
            }
            sent.push(event);
            return true;
        });
        delivery.enqueue(followUp, completion);
        expect(sent).toHaveLength(0);
        ready = true;
        delivery.flush();
        expect(sent).toHaveLength(1);
        delivery.flush();
        expect(sent).toHaveLength(1);
    });

    test('simultaneous completions stay separate and duplicate pending reports are ignored', () => {
        const { delivery, sent, drain } = setup();
        delivery.enqueue(followUp, completion);
        delivery.enqueue(followUp, completion);
        delivery.enqueue({ ...followUp, turnId: 'turn-2', chat: 'Second' }, { state: 'error', answer: 'Tests failed.' });
        expect(sent).toHaveLength(1);
        drain();
        expect(sent.filter((event) => event.type === 'session.commentary.append')).toHaveLength(2);
        expect(sent.map((event) => event.content).join('')).toContain('Tests failed.');
    });

    test('clearing a chat cancels its announcement and preserves other chat results', () => {
        const { delivery, sent, drain } = setup();
        delivery.enqueue(followUp, completion);
        const old = sent[0]!;
        delivery.enqueue({ ...followUp, key: 'other:chat', chat: 'Other chat' }, completion);
        delivery.cancelChat(followUp.key);
        delivery.handle(ack(old));
        drain();
        expect(sent.filter((event) => event.type === 'session.commentary.append')).toHaveLength(1);
        expect(
            sent
                .slice(1)
                .map((event) => event.content)
                .join('')
        ).toContain('Other chat');
    });

    test('ending the session drops pending announcements and ignores late acknowledgments', () => {
        const { delivery, sent } = setup();
        delivery.enqueue(followUp, completion);
        delivery.clear();
        delivery.handle(ack(sent[0]!));
        delivery.flush();
        expect(sent).toHaveLength(1);
    });
});
