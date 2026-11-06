import { describe, expect, test } from 'bun:test';
import { EXPLAIN_DOCUMENTATION_MAX, EXPLAIN_SOURCE_MAX, explainPrompt } from './editor-assist-explain.ts';
import { cleanGhost, GHOST_MAX_LINES, ghostPrompt } from './editor-assist-ghost.ts';
import { NAMES_ASKED, namesPrompt, parseNames } from './editor-assist-names.ts';
import { EDITOR_ASSIST_INSTRUCTIONS } from './editor-assist-purposes.ts';
import { EDITOR_ASSIST_PROMPT_MAX, EDITOR_ASSIST_PROVIDER_LIST, EditorAssistPurposeSchema } from './editor-assist.ts';

describe('the instructions of each purpose', () => {
    test('exist for every purpose a request names', () => {
        expect(Object.keys(EDITOR_ASSIST_INSTRUCTIONS).sort()).toEqual([...EditorAssistPurposeSchema.options].sort());
    });

    test('ask for as many names as the parser is given room for', () => {
        expect(EDITOR_ASSIST_INSTRUCTIONS.names).toContain(`exactly ${NAMES_ASKED} different names`);
        expect(parseNames(Array.from({ length: NAMES_ASKED + 2 }, (_, index) => `name${index}`).join('\n'), 'old', 'typescript', NAMES_ASKED)).toHaveLength(
            NAMES_ASKED
        );
    });

    test('tell the model about the tags the request is written with, and the lines the reply is cut to', () => {
        const request = ghostPrompt({ language: 'typescript', file: 'a.ts', before: 'a', after: 'b' });

        expect(EDITOR_ASSIST_INSTRUCTIONS.ghost).toContain('<before>');
        expect(EDITOR_ASSIST_INSTRUCTIONS.ghost).toContain('<after>');
        expect(EDITOR_ASSIST_INSTRUCTIONS.ghost).not.toContain('<cursor>');
        expect(request).toContain('<before>');
        expect(request).toContain('<after>');
        expect(EDITOR_ASSIST_INSTRUCTIONS.ghost).toContain(`at most ${GHOST_MAX_LINES} lines`);
        expect(cleanGhost('x\n'.repeat(GHOST_MAX_LINES * 2), '', '').split('\n')).toHaveLength(GHOST_MAX_LINES);
    });
});

describe('the bounds of each request', () => {
    const wide = 'x'.repeat(300) + '\n';
    const long = wide.repeat(500);

    test('keep the largest request each purpose writes under what the wire takes', () => {
        const requests = [
            explainPrompt({ language: 'typescript', file: 'a'.repeat(200), signature: 's'.repeat(500), documentation: long, source: long }, 'English'),
            namesPrompt({ language: 'typescript', name: 'n'.repeat(64), kind: 'type parameter', context: long, uses: Array.from({ length: 50 }, () => wide) }),
            ghostPrompt({ language: 'typescript', file: 'a'.repeat(200), before: long, after: long })
        ];

        for (const request of requests) {
            expect(request.length).toBeLessThan(EDITOR_ASSIST_PROMPT_MAX);
        }
        expect(EXPLAIN_SOURCE_MAX + EXPLAIN_DOCUMENTATION_MAX).toBeLessThan(EDITOR_ASSIST_PROMPT_MAX);
    });
});

test('the providers an editor model can come from read as a list a person sees in a refusal', () => {
    expect(EDITOR_ASSIST_PROVIDER_LIST).toBe('Claude, Codex, Grok or Antigravity');
});
