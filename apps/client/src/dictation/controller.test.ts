import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { SpeechState } from '@ruimte/desktop-bridge';
import { cancelDictation, registerDictationTarget, setDictationEngine, stopDictation, toggleDictation, useDictation, type DictationTarget } from './controller';
import { DictationError, type DictationHandlers } from './engine';

const fakeEngine = () => {
    let handlers: DictationHandlers | null = null;
    const calls: string[] = [];
    const engine = {
        start: (_options: unknown, next: DictationHandlers) => {
            handlers = next;
            calls.push('start');
            return {
                stop: () => calls.push('stop'),
                cancel: () => calls.push('cancel')
            };
        }
    };
    return { engine, calls, handlers: () => handlers! };
};

const target = (id = 'field') => {
    const inserted: string[] = [];
    const previews: string[] = [];
    const element = { isConnected: true } as unknown as HTMLElement;
    const dictationTarget: DictationTarget = {
        id,
        element,
        capture: () => ({ insert: (text) => inserted.push(text), preview: (text) => previews.push(text) })
    };
    return { target: dictationTarget, inserted, previews };
};

const READY = { enabled: true, phase: 'ready' } as unknown as SpeechState;

describe('the dictation controller', () => {
    let fake = fakeEngine();
    let restore: () => void = () => undefined;

    beforeEach(() => {
        fake = fakeEngine();
        restore = setDictationEngine(fake.engine);
        useDictation.setState({ model: READY });
    });

    afterEach(() => {
        cancelDictation();
        restore();
    });

    test('inserts the final transcript once, and only after stopping', () => {
        const field = target();
        toggleDictation(field.target);
        fake.handlers().onReady?.();
        fake.handlers().onChunk({ text: 'Hallo', final: false });
        fake.handlers().onChunk({ text: 'Hallo wereld.', final: true });
        expect(field.previews).toEqual(['Hallo', 'Hallo wereld.']);
        expect(field.inserted).toEqual([]);

        stopDictation();
        expect(fake.calls).toEqual(['start', 'stop']);
        expect(field.inserted).toEqual([]);
        fake.handlers().onEnd();
        expect(field.inserted).toEqual(['Hallo wereld.']);
        expect(useDictation.getState().phase).toBe('idle');
    });

    test('a cancel discards the words, and nothing that arrives after it inserts', () => {
        const field = target();
        toggleDictation(field.target);
        fake.handlers().onReady?.();
        fake.handlers().onChunk({ text: 'Weg ermee.', final: true });
        cancelDictation();
        expect(fake.calls).toEqual(['start', 'cancel']);

        fake.handlers().onChunk({ text: 'Te laat.', final: true });
        fake.handlers().onEnd();
        expect(field.inserted).toEqual([]);
        expect(useDictation.getState().targetId).toBeNull();
    });

    test('a failure says what went wrong in words, never as a code, and inserts nothing', () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        const field = target();
        toggleDictation(field.target);
        fake.handlers().onReady?.();
        fake.handlers().onChunk({ text: 'Half', final: true });
        fake.handlers().onError(new DictationError('recognition', 'helper crashed'));
        fake.handlers().onEnd();

        const state = useDictation.getState();
        expect(state.phase).toBe('error');
        expect(state.error).toBe('Speech recognition stopped with an error. Try again.');
        expect(field.inserted).toEqual([]);
        warn.mockRestore();
    });

    test('a target that goes away takes its run along, so its words never land elsewhere', () => {
        const field = target();
        const unregister = registerDictationTarget(field.target);
        toggleDictation(field.target);
        fake.handlers().onReady?.();
        fake.handlers().onChunk({ text: 'Nergens heen.', final: true });
        unregister();
        expect(fake.calls).toEqual(['start', 'cancel']);

        fake.handlers().onEnd();
        expect(field.inserted).toEqual([]);
        expect(useDictation.getState().phase).toBe('idle');
    });
});
