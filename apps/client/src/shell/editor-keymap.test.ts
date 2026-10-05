import { describe, expect, test } from 'bun:test';
import { matchesShortcut, shortcut, type Shortcut } from '@adecore/ui';
import { KEYMAP, KEYMAP_IDS, type KeymapId } from '@ruimte/smart-editor/keymap';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { shortcutFor } from '@/shell/editor-keymap';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { shellShortcuts } from '@/terminal/keymap';

/* What Ruimte answers from anywhere, a focused editor included: the shortcuts the editor hands back to the page, and the two that act on the surface in front. */
function ownShortcuts(apple: boolean): Shortcut[] {
    return [
        ...shellShortcuts(apple),
        APP_SHORTCUTS.sidebar,
        CANVAS_SHORTCUTS.find,
        CANVAS_SHORTCUTS.findReplace,
        shortcut(apple ? 'Alt+Meta+I' : 'Ctrl+Shift+I')
    ];
}

function signature(target: Shortcut, apple: boolean): string {
    const meta = target.meta || (target.mod && apple);
    const ctrl = target.ctrl || (target.mod && !apple);
    return [meta, ctrl, target.alt, target.shift, target.key].join('|');
}

const hasModifier = (target: Shortcut): boolean => target.mod || target.ctrl || target.meta || target.alt || target.shift;

describe('the editor key table', () => {
    for (const apple of [true, false]) {
        const platform = apple ? 'macOS' : 'the other platforms';
        const own = new Set(ownShortcuts(apple).map((candidate) => signature(candidate, apple)));

        test(`parses on ${platform} and takes no key Ruimte answers from anywhere`, () => {
            for (const id of KEYMAP_IDS) {
                const found = shortcutFor(id, apple);
                if (found !== undefined) {
                    expect(own.has(signature(found, apple)), `${id} is ${signature(found, apple)}, which Ruimte holds`).toBe(false);
                    expect(hasModifier(found), `${id} has no modifier`).toBe(true);
                }
            }
        });

        test(`names, on ${platform}, what holds each key the platform has and Ruimte keeps`, () => {
            for (const id of KEYMAP_IDS) {
                const taken = KEYMAP[id as KeymapId][apple ? 'takenMac' : 'takenOther'] as { platform: string; by: string } | undefined;
                if (taken === undefined) {
                    continue;
                }
                const platformKey = shortcut(taken.platform);
                const bare = !platformKey.mod && !platformKey.ctrl && !platformKey.meta && !platformKey.alt;
                const held = ownShortcuts(apple).some((candidate) => matchesShortcut(candidate, eventOf(platformKey, apple), apple)) || bare;
                expect(held, `${id}: ${taken.platform} is not held by anything`).toBe(true);
            }
        });
    }
});

describe('Inline Edit', () => {
    for (const apple of [true, false]) {
        test(`is Mod+I on ${apple ? 'macOS' : 'the other platforms'}, a key no other editor command and nothing of Ruimte's holds`, () => {
            const found = shortcutFor('inlineEdit', apple)!;
            const mine = signature(found, apple);

            expect(mine).toBe(signature(shortcut('Mod+I'), apple));
            expect(
                KEYMAP_IDS.filter(
                    (id) => id !== 'inlineEdit' && [shortcutFor(id, apple)].some((other) => other !== undefined && signature(other, apple) === mine)
                )
            ).toEqual([]);
            expect(ownShortcuts(apple).some((candidate) => signature(candidate, apple) === mine)).toBe(false);
        });
    }
});

describe('ghost text keys', () => {
    for (const apple of [true, false]) {
        for (const [id, chord] of [
            ['suggestInline', 'Alt+\\'],
            ['acceptGhostWord', 'Alt+]']
        ] as const) {
            test(`${id} is ${chord} on ${apple ? 'macOS' : 'the other platforms'}, a key no other editor command and nothing of Ruimte's holds`, () => {
                const mine = signature(shortcutFor(id, apple)!, apple);

                expect(mine).toBe(signature(shortcut(chord), apple));
                expect(
                    KEYMAP_IDS.filter(
                        (other) => other !== id && [shortcutFor(other, apple)].some((found) => found !== undefined && signature(found, apple) === mine)
                    )
                ).toEqual([]);
                expect(ownShortcuts(apple).some((candidate) => signature(candidate, apple) === mine)).toBe(false);
            });
        }
    }
});

function eventOf(target: Shortcut, apple: boolean): Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> {
    const letter = /^[A-Z]$/.test(target.key);
    const code: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash' };
    return {
        key: letter ? target.key.toLowerCase() : target.key,
        code: letter ? `Key${target.key}` : /^[0-9]$/.test(target.key) ? `Digit${target.key}` : (code[target.key] ?? target.key),
        ctrlKey: target.ctrl || (target.mod && !apple),
        metaKey: target.meta || (target.mod && apple),
        altKey: target.alt,
        shiftKey: target.shift
    };
}
