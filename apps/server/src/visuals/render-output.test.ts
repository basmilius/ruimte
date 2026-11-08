import { describe, expect, test } from 'bun:test';
import { classifyRenderLine } from './render-protocol.ts';
import { readOutput } from './renderer.ts';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream({
        start(controller) {
            chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
            controller.close();
        }
    });
}

describe('the output of a render child', () => {
    test('tells a proxy notice from an answer and from anything else', () => {
        expect(classifyRenderLine('{"proxyPort":40123}')).toEqual({ kind: 'proxy', port: 40123 });
        expect(classifyRenderLine('{"ok":true,"pages":[]}')).toEqual({ kind: 'answer', answer: { ok: true, pages: [] } });
        expect(classifyRenderLine('{"proxyPort":0}')).toBeNull();
        expect(classifyRenderLine('not json')).toBeNull();
        expect(classifyRenderLine('{"hello":1}')).toBeNull();
    });

    test('reserves the proxy port as soon as it is told and still returns the answer, across split chunks', async () => {
        const reserved: number[] = [];
        const releases: Array<() => void> = [];
        const answer = await readOutput(
            streamOf('{"proxyPo', 'rt":40123}\n{"ok":true,', '"pages":[]}\n'),
            (port) => {
                reserved.push(port);

                return () => undefined;
            },
            releases
        );

        expect(reserved).toEqual([40123]);
        expect(releases).toHaveLength(1);
        expect(answer).toEqual({ ok: true, pages: [] });
    });

    test('has no answer when the child ended before it gave one, but its proxy is still handed back to release', async () => {
        const releases: Array<() => void> = [];

        expect(await readOutput(streamOf('{"proxyPort":40125}\n'), () => () => undefined, releases)).toBeNull();
        expect(releases).toHaveLength(1);
    });
});
