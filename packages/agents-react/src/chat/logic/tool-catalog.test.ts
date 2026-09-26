import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { TOOL_CATALOG } from './tool-catalog';
import { isFileChange, readImagePath, toolSummary } from './tools';

describe('the tool catalog', () => {
    /* The four tables this replaced drifted apart, so the one that is left has to hold up on its own. */
    test('gives every tool it knows an icon and a way to read its summary', () => {
        for (const [name, tool] of Object.entries(TOOL_CATALOG)) {
            expect(tool.icon, name).toBeDefined();
            expect(Array.isArray(tool.summary), name).toBe(true);
        }
    });

    test('has a sentence for every name that groups, which locales.test.ts then holds Dutch to', () => {
        for (const [name, tool] of Object.entries(TOOL_CATALOG)) {
            if (!tool.grouped) {
                continue;
            }
            expect(i18next.exists(`agent-chat:group.tools.${name}`, { count: 2 }), name).toBe(true);
        }
        // The one name that says it has none, so the check above is not passing on an empty answer.
        expect(TOOL_CATALOG.NotebookRead?.grouped).toBe(false);
        expect(i18next.exists('agent-chat:group.tools.NotebookRead', { count: 2 })).toBe(false);
    });

    test('reads a line out of the calls that used to fall back to the first string of their input', () => {
        expect(toolSummary('ApplyPatch', { summary: 'a.ts, b.ts', changes: [] })).toBe('a.ts, b.ts');
        expect(toolSummary('TodoWrite', { todos: [{ content: 'write the thing' }] })).toBe('');
        expect(toolSummary('Bash', { description: 'run the tests', command: 'bun test' })).toBe('run the tests');
    });

    // An MCP tool is never in the table, and the first string it was given still beats nothing.
    test('falls back to the first string of an input it has no entry for', () => {
        expect(toolSummary('mcp__thing__do', { target: 'the thing' })).toBe('the thing');
    });

    test('says which calls change a file and which read an image', () => {
        expect(isFileChange('ApplyPatch')).toBe(true);
        expect(isFileChange('MultiEdit')).toBe(true);
        expect(isFileChange('Read')).toBe(false);
        expect(readImagePath('NotebookRead', { file_path: '/a/plot.png' })).toBe('/a/plot.png');
        expect(readImagePath('Edit', { file_path: '/a/plot.png' })).toBeNull();
    });
});
