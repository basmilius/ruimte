import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_INDEX } from './search';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// Ids a pane composes at run time, or that the shared agents package draws, so no literal is in these sources.
const COMPOSED_PREFIXES = ['editor.folding.', 'editor.smartKeys.', 'agents.', 'keyboard.', 'computer.grant.', 'providers.defaults.', 'usage.'];

function sourcesIn(folder: string): string[] {
    return readdirSync(folder).flatMap((name) => {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
            return sourcesIn(path);
        }
        return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [readFileSync(path, 'utf8')] : [];
    });
}

describe('the settings index', () => {
    test('every id leads to a row a pane draws', () => {
        const source = sourcesIn(HERE).join('\n');
        const missing = SETTINGS_INDEX.map((entry) => entry.id)
            .filter((id) => !COMPOSED_PREFIXES.some((prefix) => id.startsWith(prefix)))
            .filter((id) => !source.includes(`searchId="${id}"`) && !source.includes(`'${id}'`) && !source.includes(`"${id}"`));
        expect(missing).toEqual([]);
    });
});
