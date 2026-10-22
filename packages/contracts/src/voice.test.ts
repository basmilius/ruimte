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
        for (const name of [
            'voice.keyStatus',
            'voice.setKey',
            'voice.clearKey',
            'voice.preferences',
            'voice.setPreferences',
            'voice.start',
            'voice.stop',
            'voice.confirm'
        ]) {
            expect(Object.hasOwn(REQUEST_SCHEMAS, name)).toBe(true);
        }
        for (const name of ['voice.status', 'voice.activity', 'voice.preferences']) {
            expect(Object.hasOwn(EVENT_SCHEMAS, name)).toBe(true);
        }
    });

    test('the preferences take both fields from the lists, and none stored reads as null', () => {
        const set = REQUEST_SCHEMAS['voice.setPreferences'].payload;
        expect(set.parse({ language: 'nl', voice: 'cedar' })).toEqual({ language: 'nl', voice: 'cedar' });
        expect(set.safeParse({ language: 'nl' }).success).toBe(false);
        expect(set.safeParse({ language: 'klingon', voice: 'cedar' }).success).toBe(false);
        expect(REQUEST_SCHEMAS['voice.preferences'].result.parse({ preferences: null })).toEqual({ preferences: null });
        expect(EVENT_SCHEMAS['voice.preferences'].safeParse({ preferences: { language: 'en', voice: 'marin' } }).success).toBe(true);
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
        // The machine's own preferences come first, so a start may name neither.
        expect(payload.safeParse({ ...start, language: undefined, voice: undefined }).success).toBe(true);
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

    test('a line that waits on the person carries its question, and every other line none', () => {
        const event = EVENT_SCHEMAS['voice.activity'];
        const line = { id: 'call-1', at: 1, kind: 'chat', status: 'running', label: 'Clear AI Chat', detail: '' };
        expect(event.safeParse({ sessionId: 'voice-1', sceneId: 'scene-1', seq: 2, entry: line }).success).toBe(true);
        const asked = { ...line, confirmation: { token: 't', title: 'Clear AI Chat “Builder”?', consequences: ['It cannot be undone.'] } };
        expect(event.safeParse({ sessionId: 'voice-1', sceneId: 'scene-1', seq: 2, entry: asked }).success).toBe(true);
        expect(event.safeParse({ sessionId: 'voice-1', sceneId: 'scene-1', seq: 2, entry: { ...asked, confirmation: { title: 'Clear?' } } }).success).toBe(
            false
        );
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
