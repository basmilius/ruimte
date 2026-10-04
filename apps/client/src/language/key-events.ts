import type { Shortcut } from '@basmilius/desktop-ui';
import { isApplePlatform } from '@/desktop/bridge';

const CODES: Record<string, string> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    '\\': 'Backslash',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '-': 'Minus',
    '=': 'Equal'
};

/* The keydown a person pressing the shortcut sends, for tests that press the editor's keys. */
export function eventOf(target: Shortcut, apple = isApplePlatform()): Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> {
    const { key } = target;
    const letter = /^[A-Z]$/.test(key);
    return {
        key: letter ? key.toLowerCase() : key === 'Space' ? ' ' : key,
        code: letter ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : (CODES[key] ?? key),
        ctrlKey: target.ctrl || (target.mod && !apple),
        metaKey: target.meta || (target.mod && apple),
        altKey: target.alt,
        shiftKey: target.shift
    };
}
