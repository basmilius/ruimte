import { expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { RESUME_COMPACTION_IDLE_MS, RESUME_COMPACTION_TOKENS, resumeCompactionOffer } from './resume-compaction';

const NOW = 1_800_000_000_000;
const ENDED = NOW - RESUME_COMPACTION_IDLE_MS;

const info = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
    chatId: 'chat-1',
    provider: 'claude',
    cwd: '/tmp/project',
    agentSessionId: 'session-1',
    model: 'claude-opus-5',
    selection: { model: 'claude-opus-5', options: {} },
    runtimeMode: 'supervised',
    status: 'idle',
    running: true,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: RESUME_COMPACTION_TOKENS, contextWindow: 1_000_000, costUsd: 1, turns: 4 },
    createdAt: 0,
    ...patch
});

const turn = (id: string, endedAt: number | null): ChatItem => ({
    id,
    kind: 'turn',
    createdAt: 0,
    turnId: id,
    state: endedAt === null ? 'running' : 'done',
    endedAt,
    costUsd: 0
});

const compaction = (turnId: string): ChatItem => ({ id: `compaction-${turnId}`, kind: 'compaction', createdAt: 0, turnId, preTokens: 180_000 });

const offer = (patch: Partial<Parameters<typeof resumeCompactionOffer>[0]> = {}) =>
    resumeCompactionOffer({ info: info(), compaction: 'prompt', items: [turn('turn-1', ENDED)], dismissedTurnId: null, now: NOW, ...patch });

test('a quiet chat with enough context is offered a compaction, and the offer names the turn it is about', () => {
    expect(offer()).toEqual({ turnId: 'turn-1', tokens: RESUME_COMPACTION_TOKENS });
    expect(offer({ compaction: 'native' })).toEqual({ turnId: 'turn-1', tokens: RESUME_COMPACTION_TOKENS });
});

test('a provider that cannot compact is never offered it, and neither is one whose capabilities did not arrive', () => {
    expect(offer({ compaction: 'none' })).toBeNull();
    expect(offer({ compaction: undefined })).toBeNull();
});

test('the token threshold is a floor, not a ceiling', () => {
    expect(offer({ info: info({ usage: { contextTokens: RESUME_COMPACTION_TOKENS - 1, contextWindow: 200_000, costUsd: 1, turns: 4 } }) })).toBeNull();
    expect(offer({ info: info({ usage: { contextTokens: 400_000, contextWindow: 1_000_000, costUsd: 1, turns: 4 } }) })?.tokens).toBe(400_000);
});

test('the idle threshold is a floor too, and a turn still running has no end to measure from', () => {
    expect(offer({ now: ENDED + RESUME_COMPACTION_IDLE_MS - 1 })).toBeNull();
    expect(offer({ items: [turn('turn-1', null)] })).toBeNull();
    expect(offer({ items: [] })).toBeNull();
});

test('a chat that is working or has a message waiting is left alone', () => {
    expect(offer({ info: info({ activeTurnId: 'turn-2' }) })).toBeNull();
    expect(offer({ info: info({ queue: [{ id: 'queued-1', text: 'later', createdAt: 0 }] }) })).toBeNull();
});

test('a turn that already compacted is not offered it again, in either shape', () => {
    expect(offer({ items: [turn('turn-1', ENDED), compaction('turn-1')] })).toBeNull();
    expect(offer({ items: [turn('turn-1', ENDED), compaction('turn-0'), turn('turn-2', ENDED)] })).toEqual({
        turnId: 'turn-2',
        tokens: RESUME_COMPACTION_TOKENS
    });
});

test('keeping the full history holds for that turn only', () => {
    expect(offer({ dismissedTurnId: 'turn-1' })).toBeNull();
    expect(offer({ dismissedTurnId: 'turn-0' })).toEqual({ turnId: 'turn-1', tokens: RESUME_COMPACTION_TOKENS });
    expect(offer({ items: [turn('turn-1', ENDED), turn('turn-2', ENDED)], dismissedTurnId: 'turn-1' })).toEqual({
        turnId: 'turn-2',
        tokens: RESUME_COMPACTION_TOKENS
    });
});
