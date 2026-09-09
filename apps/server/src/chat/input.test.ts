import { describe, expect, test } from 'bun:test';
import { buildUserMessage } from './input.ts';

const png = { name: 'shot.png', mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };

describe('buildUserMessage', () => {
    test('text alone is one text block in a user frame', () => {
        expect(buildUserMessage({ text: 'hello' })).toEqual({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            parent_tool_use_id: null,
            session_id: ''
        });
    });

    test('the prefix goes in front of the text, inside the same block', () => {
        const frame = buildUserMessage({ text: 'plan it', prefix: 'ultrathink\n\n' });
        expect((frame.message as { content: Array<{ text: string }> }).content[0]!.text).toBe('ultrathink\n\nplan it');
    });

    test('attachments follow the text as base64 image blocks', () => {
        const frame = buildUserMessage({ text: 'what is this', attachments: [png] });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'what is this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
        ]);
    });

    test('an image without text does not send an empty text block', () => {
        const frame = buildUserMessage({ text: '  ', attachments: [png] });
        expect((frame.message as { content: Array<{ type: string }> }).content.map((block) => block.type)).toEqual(['image']);
    });
});
