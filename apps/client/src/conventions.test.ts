import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

const sources = (): { path: string; text: string }[] =>
    [...new Glob('**/*.{ts,tsx}').scanSync(HERE)]
        .filter((path) => !path.endsWith('.test.ts'))
        .sort()
        .map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

/* Where a key may be heard on the window, and why there. */
const KEY_LISTENERS: Record<string, string> = {
    'shell/app-shortcuts.ts': "the window's own shortcuts, bound once",
    'canvas/canvas-shortcuts.ts': 'what acts on the project, bound once by the workspace',
    'drawing/use-drawing-keys.ts': "a drawing view's bare tool keys, the one exception the product rules allow, and only while that drawing has the keyboard",
    'ui/ShortcutHints.tsx': 'mounted once, and only watches a modifier held on its own; it binds no shortcut',
    'ui/modality.ts': 'started once, and only notes that the keyboard is in use; it binds no shortcut'
};

describe('the conventions of the client', () => {
    test('a key is heard on the window only where a shortcut may be bound', () => {
        const listening = sources()
            .filter(({ text }) => /(window|document)\.addEventListener\(\s*['"]key(down|up)['"]/.test(text))
            .map(({ path }) => path);
        expect(listening.filter((path) => !(path in KEY_LISTENERS))).toEqual([]);
    });
});
