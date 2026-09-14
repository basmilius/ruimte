import { describe, expect, test } from 'bun:test';
import { channelBinding, DIRECT_PIECE_CHARS, DirectProofFrameSchema, FrameAssembler, sdpFingerprints, splitFrame } from './direct.ts';

const reassemble = (pieces: string[], maxChars = Number.MAX_SAFE_INTEGER): string[] => {
    const assembler = new FrameAssembler();
    const frames: string[] = [];
    for (const piece of pieces) {
        const result = assembler.push(piece, maxChars);
        if (result.kind === 'frame') {
            frames.push(result.frame);
        }
    }
    return frames;
};

describe('splitFrame', () => {
    test('a small frame is one piece', () => {
        expect(splitFrame('{"id":"1"}')).toEqual(['={"id":"1"}']);
    });

    test('a large frame comes back whole, and no piece is longer than the limit plus its mark', () => {
        const data = 'x'.repeat(DIRECT_PIECE_CHARS * 3 + 17);
        const pieces = splitFrame(data);
        expect(pieces).toHaveLength(4);
        expect(pieces.every((piece) => piece.length <= DIRECT_PIECE_CHARS + 1)).toBe(true);
        expect(reassemble(pieces)).toEqual([data]);
    });

    test('a surrogate pair on the edge of a piece stays in one piece', () => {
        const data = `${'a'.repeat(9)}\u{1F600}${'b'.repeat(10)}`;
        const pieces = splitFrame(data, 10);
        for (const piece of pieces) {
            // Encoding each piece on its own must not turn half a pair into a replacement character.
            expect(new TextDecoder().decode(new TextEncoder().encode(piece))).toBe(piece);
        }
        expect(reassemble(pieces)).toEqual([data]);
    });
});

describe('FrameAssembler', () => {
    test('a frame past the limit is invalid and the next one starts clean', () => {
        const assembler = new FrameAssembler();
        expect(assembler.push('+aaaa', 6).kind).toBe('partial');
        expect(assembler.push('+aaaa', 6).kind).toBe('invalid');
        expect(assembler.push('=ok', 6)).toEqual({ kind: 'frame', frame: 'ok' });
    });

    test('a piece without a mark is invalid', () => {
        expect(new FrameAssembler().push('{"id":"1"}', 100).kind).toBe('invalid');
    });
});

describe('channelBinding', () => {
    const offer = 'v=0\r\na=fingerprint:SHA-256 ab:cd\r\nm=application 9\r\na=fingerprint:sha-256 AB:CD\r\n';
    const answer = 'v=0\r\na=fingerprint:sha-256 12:34\r\n';

    test('reads every fingerprint once, whatever its case', () => {
        expect(sdpFingerprints(offer)).toEqual(['sha-256 AB:CD']);
    });

    test('changes when either side announces another certificate', () => {
        const binding = channelBinding(offer, answer);
        expect(channelBinding(offer, answer)).toBe(binding);
        expect(channelBinding(offer.replaceAll('ab:cd', 'ef:01').replaceAll('AB:CD', 'EF:01'), answer)).not.toBe(binding);
        expect(channelBinding(offer, answer.replace('12:34', '56:78'))).not.toBe(binding);
        expect(channelBinding(answer, offer)).not.toBe(binding);
    });
});

test('a proof is either a key signature or a secret proof, nothing else', () => {
    expect(DirectProofFrameSchema.safeParse({ type: 'direct.key', challenge: 'c', publicKey: 'k', signature: 's' }).success).toBe(true);
    expect(DirectProofFrameSchema.safeParse({ type: 'direct.secret', challenge: 'c', proof: 'p' }).success).toBe(true);
    expect(DirectProofFrameSchema.safeParse({ type: 'direct.token', token: 't' }).success).toBe(false);
});
