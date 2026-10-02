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
        (globalThis as { document?: unknown }).document = { hasFocus: () => true };
    });

    afterEach(() => {
        cancelDictation();
        restore();
        delete (globalThis as { document?: unknown }).document;
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

    describe('when the window loses the focus', () => {
        let focused = false;
        beforeEach(() => {
            focused = false;
            (globalThis as { document?: unknown }).document = { hasFocus: () => focused };
        });
        afterEach(() => {
            focused = true;
        });

        test("it lets the system's question for the microphone take the focus, and ends a run that starts after it", () => {
            const field = target();
            toggleDictation(field.target);
            cancelDictation();
            expect(fake.calls).toEqual(['start']);
            expect(useDictation.getState().phase).toBe('starting');

            fake.handlers().onAccess?.();
            cancelDictation();
            expect(fake.calls).toEqual(['start', 'cancel']);
            expect(useDictation.getState().phase).toBe('idle');
        });

        test('it ends a recording', () => {
            const field = target();
            toggleDictation(field.target);
            fake.handlers().onReady?.();
            cancelDictation();
            expect(fake.calls).toEqual(['start', 'cancel']);
        });

        test('a run that is finishing still lands its words, where a person who cancels discards them', () => {
            const field = target();
            toggleDictation(field.target);
            fake.handlers().onReady?.();
            fake.handlers().onChunk({ text: 'Toch nog.', final: true });
            stopDictation();
            cancelDictation();
            fake.handlers().onEnd();
            expect(fake.calls).toEqual(['start', 'stop']);
            expect(field.inserted).toEqual(['Toch nog.']);

            focused = true;
            const next = target('other');
            toggleDictation(next.target);
            fake.handlers().onReady?.();
            fake.handlers().onChunk({ text: 'Weg.', final: true });
            stopDictation();
            cancelDictation();
            fake.handlers().onEnd();
            expect(next.inserted).toEqual([]);
        });

        test('an error stays on screen', () => {
            const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
            const field = target();
            toggleDictation(field.target);
            fake.handlers().onError(new DictationError('recognition'));
            cancelDictation();
            expect(useDictation.getState().phase).toBe('error');
            warn.mockRestore();
        });
    });

    test('a target that turns disabled while it listens keeps its run, and a disabled one does not start', () => {
        // A composer is disabled while its socket is down; recognition runs here and does not need it.
        let disabled = false;
        const field = target();
        const unregister = registerDictationTarget({ ...field.target, disabled: () => disabled });
        toggleDictation({ ...field.target, disabled: () => disabled });
        fake.handlers().onReady?.();
        disabled = true;
        fake.handlers().onChunk({ text: 'Nog steeds hier.', final: true });
        stopDictation();
        fake.handlers().onEnd();
        expect(fake.calls).toEqual(['start', 'stop']);
        expect(field.inserted).toEqual(['Nog steeds hier.']);

        toggleDictation({ ...field.target, disabled: () => disabled });
        expect(fake.calls).toEqual(['start', 'stop']);
        expect(useDictation.getState().phase).toBe('idle');
        unregister();
    });
});
