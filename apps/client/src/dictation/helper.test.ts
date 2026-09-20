import { describe, expect, test } from 'bun:test';
import type { SpeechBridge, SpeechEvent } from '@ruimte/desktop-bridge';
import { HelperSession, type Capture } from './helper';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
};
const fixture = () => {
    const ready = deferred<void>();
    const calls: string[] = [];
    let id = '';
    let listener: ((event: SpeechEvent) => void) | null = null;
    let samples!: (value: Float32Array) => void;
    const stream = { getTracks: () => [{ stop: () => calls.push('track-stop') }] } as unknown as MediaStream;
    const capture: Capture = {
        start: async () => {
            calls.push('capture');
        },
        finish: async () => {
            calls.push('flush');
            samples(new Float32Array([0.5]));
        },
        stop: () => {
            calls.push('capture-stop');
        }
    };
    const bridge = {
        start: (sessionId: string) => {
            id = sessionId;
            calls.push('start');
            return ready.promise;
        },
        samples: async () => {
            calls.push('samples');
        },
        stop: async () => {
            calls.push('stop');
        },
        cancel: async () => {
            calls.push('cancel');
        },
        onEvent: (next: (event: SpeechEvent) => void) => {
            listener = next;
            return () => {
                calls.push('unsubscribe');
                listener = null;
            };
        }
    } as unknown as SpeechBridge;
    const session = new HelperSession(
        { language: 'nl-NL' },
        {
            onReady: () => calls.push('ready'),
            onChunk: (chunk) => calls.push(`text:${chunk.text}`),
            onError: () => calls.push('error'),
            onEnd: () => calls.push('end')
        },
        {
            bridge,
            openMicrophone: async () => {
                calls.push('microphone');
                return stream;
            },
            capture: (next) => {
                samples = next;
                return capture;
            }
        }
    );
    return {
        session,
        ready,
        calls,
        emit: (event: Omit<SpeechEvent, 'sessionId'> & { sessionId?: string }) => listener?.({ ...event, sessionId: event.sessionId ?? id } as SpeechEvent)
    };
};

describe('dictation lifecycle', () => {
    test('waits for the loaded model before opening the microphone', async () => {
        const run = fixture();
        expect(run.calls).toEqual(['start']);
        run.ready.resolve();
        await flush();
        expect(run.calls).toEqual(['start', 'microphone', 'capture', 'ready']);
        run.session.cancel();
    });
    test('cancelling a load never opens a microphone later', async () => {
        const run = fixture();
        run.session.cancel();
        run.ready.resolve();
        await flush();
        expect(run.calls).not.toContain('microphone');
        expect(run.calls.filter((call) => call === 'end')).toHaveLength(1);
    });
    test('stopping drains the final audio before telling the helper to finish', async () => {
        const run = fixture();
        run.ready.resolve();
        await flush();
        run.session.stop();
        await flush();
        expect(run.calls.indexOf('track-stop')).toBeLessThan(run.calls.indexOf('flush'));
        expect(run.calls.indexOf('samples')).toBeLessThan(run.calls.indexOf('stop'));
        expect(run.calls).not.toContain('unsubscribe');
        run.emit({ type: 'transcript', text: 'Laatste woord.', final: true } as SpeechEvent);
        run.emit({ type: 'ended' });
        expect(run.calls).toContain('text:Laatste woord.');
        expect(run.calls.at(-1)).toBe('end');
    });
    test('a crash closes the microphone and releases listeners', async () => {
        const run = fixture();
        run.ready.resolve();
        await flush();
        run.emit({ type: 'failed', message: 'crash' } as SpeechEvent);
        expect(run.calls).toContain('error');
        expect(run.calls).toContain('track-stop');
        expect(run.calls).toContain('unsubscribe');
        expect(run.calls.filter((call) => call === 'end')).toHaveLength(1);
    });
    test('ignores another session and all events after cancellation', async () => {
        const run = fixture();
        run.ready.resolve();
        await flush();
        run.emit({ type: 'transcript', sessionId: 'old-session', text: 'wrong', final: true } as SpeechEvent);
        run.session.cancel();
        run.emit({ type: 'transcript', text: 'late', final: true } as SpeechEvent);
        expect(run.calls.some((call) => call.startsWith('text:'))).toBe(false);
    });
});
