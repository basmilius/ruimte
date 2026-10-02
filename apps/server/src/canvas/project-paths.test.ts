import { describe, expect, test } from 'bun:test';
import { isInside } from './project-paths.ts';

describe('isInside', () => {
    test('a folder whose name starts with two dots is inside, a step up is not', () => {
        expect(isInside('/repo', '/repo')).toBe(true);
        expect(isInside('/repo', '/repo/..cache')).toBe(true);
        expect(isInside('/repo', '/repo/..cache/deeper')).toBe(true);
        expect(isInside('/repo', '/elsewhere')).toBe(false);
        expect(isInside('/repo/apps', '/repo')).toBe(false);
        expect(isInside('/repo', '/repo-old')).toBe(false);
    });
});
