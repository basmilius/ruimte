import { describe, expect, test } from 'bun:test';
import { renderedDocsSettings } from '@/files/use-rendered-docs';

describe('rendering documentation comments', () => {
    test('switches the editor feature off, markers and shortcut included, while the feature is off', () => {
        expect(renderedDocsSettings(true, false)).toEqual({ renderDocComments: false, enabled: false });
        expect(renderedDocsSettings(false, false)).toEqual({ renderDocComments: false, enabled: false });
        expect(renderedDocsSettings(true, true)).toEqual({ renderDocComments: true, enabled: true });
        expect(renderedDocsSettings(false, true)).toEqual({ renderDocComments: false, enabled: true });
        expect(renderedDocsSettings(true)).toEqual({ renderDocComments: false, enabled: false });
    });
});
