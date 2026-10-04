import { afterEach, describe, expect, test } from 'bun:test';
import { readEditorFont } from './chrome.ts';

const element = {} as HTMLElement;
const original = globalThis.getComputedStyle;

/* A page whose root defines these tokens and nothing else. */
const page = (tokens: Record<string, string>, ligatures = 'normal'): void => {
    globalThis.getComputedStyle = (() => ({
        getPropertyValue: (name: string) => tokens[name] ?? '',
        fontVariantLigatures: ligatures
    })) as unknown as typeof getComputedStyle;
};

afterEach(() => {
    globalThis.getComputedStyle = original;
});

describe('the code face an editor reads off the page', () => {
    test('takes the code size and line over the interface code token', () => {
        page({ '--code-font-size': '16px', '--code-line-height': '25px', '--text-code': '13px', '--text-code--line-height': '20px', '--font-mono': 'Menlo' });
        expect(readEditorFont(element)).toEqual({ fontFamily: 'Menlo', fontSize: 16, lineHeight: 25, fontLigatures: true });
    });

    test('falls back to the interface code token on a page without the code tokens', () => {
        page({ '--text-code': '13px', '--text-code--line-height': '20px' }, 'none');
        expect(readEditorFont(element)).toEqual({ fontFamily: undefined, fontSize: 13, lineHeight: 20, fontLigatures: false });
    });

    test('leaves the size to the editor on a page that defines neither', () => {
        page({});
        expect(readEditorFont(element)).toMatchObject({ fontSize: undefined, lineHeight: undefined });
    });
});
