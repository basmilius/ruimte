import { describe, expect, test } from 'bun:test';
import { extensionErrorCodeOf, type ExtensionErrorCode } from './extension-results.ts';

describe('the error codes of an extension', () => {
    test.each([
        ['forbidden', 'permission-denied'],
        ['not-connected', 'unavailable'],
        ['timeout', 'timeout'],
        ['no-launch', 'not-found'],
        ['unreadable', 'not-found'],
        ['outside-folder', 'outside-project'],
        ['internal', 'failed'],
        ['confirmation-declined', 'refused'],
        ['limit', 'limit']
    ])('read %s as %s', (code, expected) => {
        expect(extensionErrorCodeOf(code)).toBe(expected as ExtensionErrorCode);
    });
});
