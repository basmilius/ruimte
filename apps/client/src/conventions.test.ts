import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';
import { parseSync, Visitor } from 'oxc-parser';

const HERE = new URL('.', import.meta.url).pathname;
const SOURCES = [...new Glob('**/*.{ts,tsx}').scanSync(HERE)]
    .filter((path) => !path.endsWith('.test.ts'))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

const KEY_LISTENERS = new Set(['shell/app-shortcuts.ts', 'canvas/canvas-shortcuts.ts', 'drawing/use-drawing-keys.ts']);

// The speech model needs a fixed date format; no person reads it.
const INTL_OUTSIDE_FORMAT = new Set(['voice/controller.ts']);

describe('the conventions of the client', () => {
    test('a key is heard on the window only where a shortcut may be bound', () => {
        const listening = SOURCES.filter(({ text }) => /(window|document)\.addEventListener\(\s*['"]key(down|up)['"]/.test(text)).map(({ path }) => path);
        expect(listening.filter((path) => !KEY_LISTENERS.has(path))).toEqual([]);
    });

    // A component can outlive a machine switch; its cleanup must still reach the original machine.
    test('a component reaches sessions and chats through its own machine, never the active one', () => {
        const reaching = SOURCES.filter(({ path }) => path.endsWith('.tsx'))
            .filter(({ text }) => /import\s*\{[^}]*\b(sessionClient|chatClient)\b[^}]*\}\s*from\s*'@\/(terminal|transport\/connections)'/.test(text))
            .map(({ path }) => path);
        expect(reaching).toEqual([]);
    });

    test('only @adecore/ui/format builds a formatter out of Intl', () => {
        const building = SOURCES.filter(({ path }) => !INTL_OUTSIDE_FORMAT.has(path)).flatMap(({ path, text }) => {
            const found: string[] = [];
            new Visitor({
                MemberExpression(node) {
                    if (node.object.type === 'Identifier' && node.object.name === 'Intl') {
                        found.push(`${path}:${text.slice(0, node.start).split('\n').length}`);
                    }
                }
            }).visit(parseSync(path, text).program);
            return found;
        });
        expect(building).toEqual([]);
    });
});
