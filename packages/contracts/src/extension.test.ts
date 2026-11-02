import { describe, expect, test } from 'bun:test';
import {
    ExtensionMessageEventSchema,
    ExtensionStorageChangedEventSchema,
    ExtensionStorageGetResultSchema,
    ExtensionStorageSetPayloadSchema,
    ExtensionThemeSchema,
    extensionThemeCssProblem
} from './extension.ts';

const theme = { name: 'Dusk', side: 'dark', thumbnail: 'themes/dusk.png' } as const;

describe('a theme stays inside its pack', () => {
    test.each([
        ['url(https://example.com/a.png)'],
        ['url("//example.com/a.png")'],
        ['url(../../other/a.png)'],
        ['background: image-set("https://example.com/a.png" 1x)'],
        ["background: -webkit-image-set('https:example.com/a.png' 1x)"],
        ['background: image-set("ht\ttps://example.com/a.png" 1x)'],
        ['background: \\75rl(https://example.com/a.png)'],
        ['@import "x.css";']
    ])('refuses %s', (css) => {
        expect(extensionThemeCssProblem(css)).not.toBeNull();
    });

    test('keeps what reads from the pack, and words that only look like an address', () => {
        expect(extensionThemeCssProblem('body { background: url(assets/grain.png); font-family: "Inter"; }')).toBeNull();
        expect(extensionThemeCssProblem('.crumb::after { content: "/"; } .note::before { content: "Note: "; }')).toBeNull();
    });

    test('checks token values as it checks the stylesheet', () => {
        expect(ExtensionThemeSchema.safeParse({ ...theme, tokens: { '--surface': '#101014' } }).success).toBe(true);
        expect(ExtensionThemeSchema.safeParse({ ...theme, tokens: { '--surface': 'url(https://example.com/a.png)' } }).success).toBe(false);
        expect(ExtensionThemeSchema.safeParse({ ...theme, tokens: { '--surface': 'image-set("https://example.com/a.png" 1x)' } }).success).toBe(false);
    });
});

describe('a value that is not there survives JSON', () => {
    const throughJson = (value: object): unknown => JSON.parse(JSON.stringify(value));

    test('reads a key never written, and deletes one', () => {
        expect(ExtensionStorageGetResultSchema.safeParse(throughJson({ value: undefined })).success).toBe(true);
        expect(ExtensionStorageSetPayloadSchema.safeParse(throughJson({ id: 'acme.notes', key: 'draft', value: undefined })).success).toBe(true);
        expect(ExtensionStorageChangedEventSchema.safeParse(throughJson({ id: 'acme.notes', key: 'draft', value: undefined })).success).toBe(true);
    });

    test('hears an event emitted without a payload', () => {
        expect(ExtensionMessageEventSchema.safeParse(throughJson({ id: 'acme.notes', name: 'done', payload: undefined })).success).toBe(true);
    });
});
