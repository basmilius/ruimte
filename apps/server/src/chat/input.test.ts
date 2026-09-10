import { describe, expect, test } from 'bun:test';
import { buildUserMessage, splitSkillPrompt } from './input.ts';

const png = { id: 'a1', name: 'shot.png', mime: 'image/png', size: 12, path: '/home/x/.ruimte/attachments/chat-1/a1.png' };

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

    test('attachments are named by path under the text, since both CLIs read a file themselves', () => {
        const frame = buildUserMessage({ text: 'what is this', attachments: [png] });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'what is this\n\nAttached files:\n- /home/x/.ruimte/attachments/chat-1/a1.png (shot.png)' }
        ]);
    });

    test('an attachment without text carries the note alone', () => {
        const frame = buildUserMessage({ text: '  ', attachments: [png] });
        expect((frame.message as { content: Array<{ text: string }> }).content).toEqual([
            { type: 'text', text: 'Attached files:\n- /home/x/.ruimte/attachments/chat-1/a1.png (shot.png)' }
        ] as never);
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

    test('the attachment note stays in the leading block, so the invocation is still last', () => {
        const frame = buildUserMessage({ text: 'see $unslop', skills: ['unslop'], attachments: [png] });
        const blocks = (frame.message as { content: Array<{ text: string }> }).content;
        expect(blocks).toHaveLength(2);
        expect(blocks[0]!.text).toBe('see\n\nAttached files:\n- /home/x/.ruimte/attachments/chat-1/a1.png (shot.png)');
        expect(blocks[1]!.text).toBe('/unslop');
    });

    test('the prefix stays the first thing the model reads', () => {
        const frame = buildUserMessage({ text: '$unslop it', skills: ['unslop'], prefix: 'ultrathink\n\n' });
        expect((frame.message as { content: unknown[] }).content).toEqual([
            { type: 'text', text: 'ultrathink' },
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
