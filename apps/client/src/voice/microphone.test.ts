import { describe, expect, test } from 'bun:test';
import { DEFAULT_MICROPHONE_ID, microphoneConstraints, openMicrophoneStream } from '@/voice/microphone';

describe('microphone selection', () => {
    test('leaves device selection to the operating system by default', () => {
        expect(microphoneConstraints(DEFAULT_MICROPHONE_ID)).toEqual({ audio: { echoCancellation: true, noiseSuppression: true } });
    });

    test('requests the selected microphone exactly', () => {
        expect(microphoneConstraints('iphone')).toEqual({
            audio: { echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'iphone' } }
        });
    });

    test('falls back to the system default when a selected microphone disappeared', async () => {
        const requested: MediaStreamConstraints[] = [];
        const fallback = {} as MediaStream;
        const stream = await openMicrophoneStream('iphone', async (constraints) => {
            requested.push(constraints);
            if (requested.length === 1) {
                throw new DOMException('gone', 'NotFoundError');
            }
            return fallback;
        });
        expect(stream).toBe(fallback);
        expect(requested).toEqual([microphoneConstraints('iphone'), microphoneConstraints(DEFAULT_MICROPHONE_ID)]);
    });

    test('does not hide permission failures behind a fallback request', async () => {
        let requests = 0;
        await expect(
            openMicrophoneStream('iphone', async () => {
                requests += 1;
                throw new DOMException('denied', 'NotAllowedError');
            })
        ).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(requests).toBe(1);
    });
});
