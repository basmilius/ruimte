import { describe, expect, test } from 'bun:test';
import { BYTES_CHUNK_MAX, type BytesReadResult } from '@ruimte/contracts';
import { STREAM_PIECE_BYTES, answerRange, bytesStreamUrl, parseRange, type PieceQuestion, type RangeRequest } from './bytes-stream';

const MTIME = 1_700_000_000_123;

/* A machine that serves `bytes` the way `bytes.read` does, with the mtime truncated where the viewer rounded it, and counts what it was asked. */
const machine = (size: number, mime = 'video/mp4') => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
        bytes[i] = i % 251;
    }
    const asked: PieceQuestion[] = [];
    let version = `${MTIME - 1}-${size}`;
    const ask = async (question: PieceQuestion): Promise<BytesReadResult> => {
        asked.push(question);
        if (question.offset > size) {
            throw new Error(`Offset ${question.offset} is past the end`);
        }
        const slice = bytes.subarray(question.offset, question.offset + question.length);
        return { mime, size, version, offset: question.offset, data: Buffer.from(slice).toString('base64') };
    };
    return {
        bytes,
        asked,
        ask,
        change: () => {
            version = `${MTIME + 5000}-${size}`;
        }
    };
};

const request = (size: number, range: string | null, extra: Partial<RangeRequest> = {}): RangeRequest => ({
    url: `https://app.test${bytesStreamUrl({ machine: 'm1', path: '/videos/long.mp4', mtime: MTIME, size })}`,
    method: 'GET',
    mode: 'no-cors',
    range,
    ...extra
});

const bodyOf = async (response: Response): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer());

describe('parseRange', () => {
    test('reads the two forms a player sends and nothing else', () => {
        expect(parseRange('bytes=0-')).toEqual({ start: 0, end: null });
        expect(parseRange('bytes=10-20')).toEqual({ start: 10, end: 20 });
        expect(parseRange('bytes=20-10')).toBeNull();
        expect(parseRange('bytes=-500')).toBeNull();
        expect(parseRange('bytes=0-1,5-6')).toBeNull();
        expect(parseRange(null)).toBeNull();
    });
});

describe('answerRange', () => {
    test('asks for pieces as large as the wire allows', () => {
        expect(STREAM_PIECE_BYTES).toBe(BYTES_CHUNK_MAX);
    });

    test('an open range is answered up to the window, with the headers a player seeks by', async () => {
        const size = BYTES_CHUNK_MAX * 4;
        const daemon = machine(size);
        const response = await answerRange(request(size, 'bytes=100-'), daemon.ask, { windowBytes: BYTES_CHUNK_MAX * 2 });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(`bytes 100-${100 + BYTES_CHUNK_MAX * 2 - 1}/${size}`);
        expect(response.headers.get('content-length')).toBe(String(BYTES_CHUNK_MAX * 2));
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-type')).toBe('video/mp4');
        expect(await bodyOf(response)).toEqual(daemon.bytes.subarray(100, 100 + BYTES_CHUNK_MAX * 2));
        expect(daemon.asked.map((question) => [question.offset, question.length])).toEqual([
            [100, BYTES_CHUNK_MAX],
            [100 + BYTES_CHUNK_MAX, BYTES_CHUNK_MAX]
        ]);
    });

    test('a closed range is answered exactly', async () => {
        const daemon = machine(1000);
        const response = await answerRange(request(1000, 'bytes=10-20'), daemon.ask);
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 10-20/1000');
        expect(await bodyOf(response)).toEqual(daemon.bytes.subarray(10, 21));
    });

    test('a range that ends past the file ends with the file', async () => {
        const daemon = machine(1000);
        const response = await answerRange(request(1000, 'bytes=900-5000'), daemon.ask);
        expect(response.headers.get('content-range')).toBe('bytes 900-999/1000');
        expect(await bodyOf(response)).toEqual(daemon.bytes.subarray(900));
    });

    test('without a range the whole file is answered', async () => {
        const size = BYTES_CHUNK_MAX * 2 + 7;
        const daemon = machine(size);
        const response = await answerRange(request(size, null), daemon.ask, { windowBytes: 10 });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-range')).toBeNull();
        expect(await bodyOf(response)).toEqual(daemon.bytes);
    });

    test('a range that starts past the end is 416 without asking the machine', async () => {
        const daemon = machine(1000);
        const response = await answerRange(request(1000, 'bytes=1000-'), daemon.ask);
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */1000');
        expect(daemon.asked).toHaveLength(0);
    });

    test('a file that changed before the first piece is 412', async () => {
        const daemon = machine(1000);
        daemon.change();
        const response = await answerRange(request(1000, 'bytes=0-'), daemon.ask);
        expect(response.status).toBe(412);
    });

    test('a file that changed halfway fails the stream', async () => {
        const size = BYTES_CHUNK_MAX * 3;
        const daemon = machine(size);
        const response = await answerRange(request(size, 'bytes=0-'), daemon.ask, { ahead: 1 });
        expect(response.status).toBe(206);
        daemon.change();
        const reader = response.body!.getReader();
        await reader.read();
        // The piece asked ahead before the change is still the old file; the one after it is not.
        await reader.read();
        await expect(reader.read()).rejects.toThrow('The file changed while it played');
    });

    test('a refusal from the page or the machine is 502 with its reason', async () => {
        const response = await answerRange(request(1000, 'bytes=0-'), async () => {
            throw new Error('No direct connection to this machine');
        });
        expect(response.status).toBe(502);
        expect(await response.text()).toBe('No direct connection to this machine');
    });

    test('a player that stops reading stops the asking', async () => {
        const size = BYTES_CHUNK_MAX * 20;
        const daemon = machine(size);
        const response = await answerRange(request(size, 'bytes=0-'), daemon.ask, { ahead: 2 });
        const reader = response.body!.getReader();
        await reader.read();
        await reader.read();
        await reader.cancel();
        const asked = daemon.asked.length;
        expect(asked).toBe(4);
        await Promise.resolve();
        expect(daemon.asked).toHaveLength(asked);
    });

    test('a navigation never gets an answer from the machine', async () => {
        const daemon = machine(1000);
        const response = await answerRange(request(1000, null, { mode: 'navigate' }), daemon.ask);
        expect(response.status).toBe(400);
        expect(daemon.asked).toHaveLength(0);
    });

    test('only GET is answered', async () => {
        const daemon = machine(1000);
        expect((await answerRange(request(1000, null, { method: 'POST' }), daemon.ask)).status).toBe(405);
        expect(daemon.asked).toHaveLength(0);
    });

    test('a URL without the file is 400', async () => {
        const daemon = machine(1000);
        const response = await answerRange({ url: 'https://app.test/machine-bytes/file?machine=m1', method: 'GET', mode: 'no-cors', range: null }, daemon.ask);
        expect(response.status).toBe(400);
    });

    test('a type a browser would run is served as a download, and every answer is guarded', async () => {
        const daemon = machine(1000, 'text/html');
        const response = await answerRange(request(1000, 'bytes=0-'), daemon.ask);
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toBe('sandbox');
        const refused = await answerRange(request(1000, null, { mode: 'navigate' }), daemon.ask);
        expect(refused.headers.get('x-content-type-options')).toBe('nosniff');
        expect(refused.headers.get('content-security-policy')).toBe('sandbox');
    });
});
