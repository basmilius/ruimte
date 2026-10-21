import { describe, expect, test } from 'bun:test';
import { machinePlatform } from '@/chat/machine-platform';

describe('the system of a machine on an install page', () => {
    test('is the platform its hello named, as an install command names it', () => {
        expect(machinePlatform('darwin')).toBe('darwin');
        expect(machinePlatform('linux')).toBe('linux');
        expect(machinePlatform('win32')).toBe('win32');
    });

    test('is none until the hello, or for a system no command is written for', () => {
        expect(machinePlatform(null)).toBeNull();
        expect(machinePlatform('freebsd')).toBeNull();
    });
});
