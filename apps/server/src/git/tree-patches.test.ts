import { expect, test } from 'bun:test';
import { collectTreePatches } from './tree-patches.ts';

function stream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);

    return new ReadableStream({
        start(controller) {
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                controller.enqueue(bytes.slice(offset, offset + chunkSize));
            }

            controller.close();
        }
    });
}

function patch(path: string, text: string): string {
    return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${text}\n`;
}

test.each([1, 3, 11, 64])('patch boundaries and UTF-8 survive %s-byte chunks', async (chunkSize) => {
    const first = patch('one', 'café');
    const second = patch('two', 'diff --git a/fake b/fake');
    const result = await collectTreePatches(stream(first + second, chunkSize), 2, 1024, 2048);
    expect(result).toEqual([first, second]);
});

test('an oversized single line is discarded while later small files retain the unused budget', async () => {
    const huge = patch('huge', 'x'.repeat(1024 * 1024));
    const small = patch('small', 'kept');
    const result = await collectTreePatches(stream(huge + small, 4096), 2, 256, 256);
    expect(result).toEqual([null, small]);
});

test('total budget counts complete accepted patches, including a final line without a newline', async () => {
    const first = patch('one', 'kept');
    const second = patch('two', 'omitted');
    const third = 'diff --git a/tiny b/tiny\nold mode 100644\nnew mode 100755';
    const result = await collectTreePatches(stream(first + second + third, 7), 3, 512, first.length + third.length);
    expect(result).toEqual([first, null, third]);
});

test('unexpected patch count omits the whole batch rather than attaching content to the wrong file', async () => {
    expect(await collectTreePatches(stream(patch('one', 'kept'), 5), 2, 1024, 2048)).toEqual([null, null]);
});
