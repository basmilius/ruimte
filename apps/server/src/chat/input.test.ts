import { describe, expect, test } from 'bun:test';
import { buildUserMessage, splitSkillPrompt } from './input.ts';

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

describe('skill dispatch', () => {
    test('a picked skill becomes the last text block, starting with a slash', () => {
        const frame = buildUserMessage({ text: 'look at the notes and $unslop them', skills: ['unslop'] });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'look at the notes and' },
            { type: 'text', text: '/unslop them' }
        ]);
    });

    test('a message that is only the skill carries one block', () => {
        const frame = buildUserMessage({ text: '$unslop', skills: ['unslop'] });
        expect((frame.message as { content: unknown[] }).content).toEqual([{ type: 'text', text: '/unslop' }]);
    });

    test('only the last skill is invoked; the earlier ones become slash names in the leading block', () => {
        const frame = buildUserMessage({ text: 'run $lint first, then $unslop it', skills: ['unslop', 'lint'] });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'run /lint first, then' },
            { type: 'text', text: '/unslop it' }
        ]);
    });

    test('the images sit between the leading block and the invocation', () => {
        const frame = buildUserMessage({ text: 'see $unslop', skills: ['unslop'], attachments: [png] });
        expect((frame.message as { content: Array<{ type: string }> }).content.map((block) => block.type)).toEqual(['text', 'image', 'text']);
    });

    test('the prefix stays the first thing the model reads', () => {
        const frame = buildUserMessage({ text: '$unslop it', skills: ['unslop'], prefix: 'ultrathink\n\n' });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'ultrathink\n\n' },
            { type: 'text', text: '/unslop it' }
        ]);
    });

    test('a dollar word that is not a known skill stays text', () => {
        const frame = buildUserMessage({ text: 'it costs $20 and $unknown', skills: ['unslop'] });
        expect((frame.message as { content: unknown[] }).content).toEqual([{ type: 'text', text: 'it costs $20 and $unknown' }]);
    });
});

describe('splitSkillPrompt', () => {
    test('a name that prefixes another is not mistaken for it', () => {
        expect(splitSkillPrompt('use $release-notes now', ['release', 'release-notes'])).toEqual({ lead: 'use', invocation: '/release-notes now' });
    });

    test('text without a skill token is left alone', () => {
        expect(splitSkillPrompt('nothing here', ['unslop'])).toEqual({ lead: 'nothing here', invocation: null });
    });
});
