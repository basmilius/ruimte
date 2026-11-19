import { describe, expect, test } from 'bun:test';
import { builtInSkill } from './ruimte-skills.ts';
import { namedSkills, skillNote } from './skill-note.ts';

const SKETCH = builtInSkill('sketch', { 'SKILL.md': '---\nname: ruimte-sketch\ndescription: Draws a sketch.\n---\n\nDraw it.' });
const PLACED = { skill: SKETCH, path: '/home/r/skills/ruimte-sketch/SKILL.md' };

describe('a skill note', () => {
    test('is for a skill named as a token of its own, never as part of a longer name', () => {
        expect(namedSkills('($ruimte-sketch), please', [PLACED])).toEqual([PLACED]);
        expect(namedSkills('$ruimte-sketches or a$ruimte-sketch', [PLACED])).toEqual([]);
    });

    test('names the cli, model and effort the chat runs on, and the default effort where it picked none', () => {
        expect(skillNote(PLACED, { cli: 'codex', model: 'gpt-6.2-sol', effort: 'high' })).toContain(
            'This chat runs on cli codex, model gpt-6.2-sol and effort high.'
        );
        expect(skillNote(PLACED, { cli: 'codex', model: 'gpt-6.2-sol', effort: null })).toContain("model gpt-6.2-sol and the model's default effort.");
    });

    test('carries the instructions to a chat on a plain API, which reads only its project folder', () => {
        const note = skillNote(PLACED, { cli: 'nanogpt', model: 'some-model', effort: null });

        expect(note).toEndWith('Follow its instructions:\n---\nname: ruimte-sketch\ndescription: Draws a sketch.\n---\n\nDraw it.');
        expect(note).not.toContain(PLACED.path);
    });
});
