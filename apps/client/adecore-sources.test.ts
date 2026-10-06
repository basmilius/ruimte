import { describe, expect, test } from 'bun:test';
import { stripJsonImportAttributes } from './adecore-sources.ts';

describe('stripJsonImportAttributes', () => {
    test('takes the attribute off a dynamic import of a JSON file', () => {
        const code = "const load = () => import('./locales/en/agent-chat.json', { with: { type: 'json' } });";
        expect(stripJsonImportAttributes(code)).toBe("const load = () => import('./locales/en/agent-chat.json');");
    });

    test('takes the attribute off a static import of a JSON file', () => {
        const code = 'import manifest from "./models.json" with { type: "json" };';
        expect(stripJsonImportAttributes(code)).toBe('import manifest from "./models.json";');
    });

    test('leaves imports of anything else as they are', () => {
        const code = "import('./worker.js', { with: { type: 'json' } }); import data from './data.ts';";
        expect(stripJsonImportAttributes(code)).toBe(code);
    });
});
