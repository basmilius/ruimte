import { describe, expect, test } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { VOICE_LANGUAGES, LIVE_VOICES } from './voice-languages.ts';

const start = {
    startId: 'start-1',
    sceneId: 'scene-1',
    projectId: 'project-1',
    sdp: 'v=0',
    language: 'nl',
    voice: 'marin',
    timeZone: 'Europe/Amsterdam'
} as const;

const status = { sessionId: 'voice-1', sceneId: 'scene-1', seq: 0, phase: 'starting' };

describe('the Voice wire', () => {
    test('is in the request and event tables', () => {
        for (const name of ['voice.keyStatus', 'voice.setKey', 'voice.clearKey', 'voice.start', 'voice.stop', 'voice.confirm']) {
            expect(Object.hasOwn(REQUEST_SCHEMAS, name)).toBe(true);
        }
        expect(Object.hasOwn(EVENT_SCHEMAS, 'voice.status')).toBe(true);
        expect(Object.hasOwn(EVENT_SCHEMAS, 'voice.activity')).toBe(true);
    });

    test('a start names its scene and takes the languages and voices the desktop takes', () => {
        const payload = REQUEST_SCHEMAS['voice.start'].payload;
        expect(payload.parse(start)).toEqual(start);
        expect(payload.parse({ ...start, viewId: 'canvas-1' }).viewId).toBe('canvas-1');
        for (const language of VOICE_LANGUAGES) {
            expect(payload.safeParse({ ...start, language: language.id }).success).toBe(true);
        }
        for (const voice of LIVE_VOICES) {
            expect(payload.safeParse({ ...start, voice }).success).toBe(true);
        }
        expect(payload.safeParse({ ...start, language: 'klingon' }).success).toBe(false);
        expect(payload.safeParse({ ...start, sceneId: undefined }).success).toBe(false);
        expect(payload.safeParse({ ...start, startId: 'with space' }).success).toBe(false);
        expect(payload.safeParse({ ...start, sdp: 'x'.repeat(128_001) }).success).toBe(false);
    });

    test('a start answers with the session and where it stands, so no early event is missed', () => {
        const result = REQUEST_SCHEMAS['voice.start'].result;
        expect(result.safeParse({ sessionId: 'voice-1', sdp: 'v=0', status }).success).toBe(true);
        expect(result.safeParse({ sessionId: 'voice-1', sdp: 'v=0' }).success).toBe(false);
    });

    test('a stop names its scene and either the session or the start it cancels, never both', () => {
        const payload = REQUEST_SCHEMAS['voice.stop'].payload;
        expect(payload.safeParse({ sceneId: 'scene-1', sessionId: 'voice-1' }).success).toBe(true);
        expect(payload.safeParse({ sceneId: 'scene-1', startId: 'start-1' }).success).toBe(true);
        expect(payload.safeParse({ sceneId: 'scene-1' }).success).toBe(false);
        expect(payload.safeParse({ sceneId: 'scene-1', sessionId: 'voice-1', startId: 'start-1' }).success).toBe(false);
        expect(payload.safeParse({ sessionId: 'voice-1' }).success).toBe(false);
    });

    test('a confirmation names its scene, session and token', () => {
        const payload = REQUEST_SCHEMAS['voice.confirm'].payload;
        expect(payload.safeParse({ sceneId: 'scene-1', sessionId: 'voice-1', token: 't', decision: 'confirm' }).success).toBe(true);
        expect(payload.safeParse({ sessionId: 'voice-1', token: 't', decision: 'confirm' }).success).toBe(false);
        expect(payload.safeParse({ sceneId: 'scene-1', sessionId: 'voice-1', token: 't', decision: 'maybe' }).success).toBe(false);
    });

    test('a key goes in, and only whether there is one comes back', () => {
        expect(REQUEST_SCHEMAS['voice.setKey'].payload.safeParse({ key: '  ' }).success).toBe(false);
        expect(REQUEST_SCHEMAS['voice.setKey'].payload.safeParse({ key: 'x'.repeat(1025) }).success).toBe(false);
        expect(REQUEST_SCHEMAS['voice.keyStatus'].result.parse({ present: true, key: 'sk-test-secret' })).toEqual({ present: true });
        expect(REQUEST_SCHEMAS['voice.setKey'].result.parse({ present: true, key: 'sk-test-secret' })).toEqual({ present: true });
    });

    test('events name their session, scene and order', () => {
        expect(EVENT_SCHEMAS['voice.status'].safeParse({ ...status, phase: 'failed', error: { code: 'mint-failed', message: 'No session' } }).success).toBe(
            true
        );
        expect(EVENT_SCHEMAS['voice.status'].safeParse({ ...status, sceneId: undefined }).success).toBe(false);
        const entry = { id: 'call-1', at: 1, kind: 'chat', status: 'completed', label: 'Prompted', detail: 'Research' };
        expect(EVENT_SCHEMAS['voice.activity'].safeParse({ sessionId: 'voice-1', sceneId: 'scene-1', seq: 1, entry }).success).toBe(true);
        expect(EVENT_SCHEMAS['voice.activity'].safeParse({ sessionId: 'voice-1', sceneId: 'scene-1', seq: -1, entry }).success).toBe(false);
    });
});
