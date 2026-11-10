import { describe, expect, test } from 'bun:test';
import { launchCwdOf, launchGap } from './launch-rules.ts';

describe('where a launch runs', () => {
    test('is its folder below the project, or the project folder itself', () => {
        expect(launchCwdOf('/p', { cwd: 'backend' })).toBe('/p/backend');
        expect(launchCwdOf('/p', { cwd: ' ./apps/web/ ' })).toBe('/p/apps/web');
        expect(launchCwdOf('/p/', { cwd: './' })).toBe('/p');
        expect(launchCwdOf('/p', {})).toBe('/p');
        expect(launchCwdOf('/work/shop', { cwd: '../other/./x' })).toBe('/work/other/x');
    });

    test("is the private overlay's folder when a person set one, and an absolute path stays where it is", () => {
        expect(launchCwdOf('/p', { cwd: 'backend', overlay: { cwd: 'tools' } })).toBe('/p/tools');
        expect(launchCwdOf('/p', { cwd: 'backend', overlay: { cwd: '/elsewhere/' } })).toBe('/elsewhere');
        expect(launchCwdOf('/p', { cwd: '/' })).toBe('/');
    });

    test('is the same on a Windows machine', () => {
        expect(launchCwdOf('C:\\p', { cwd: 'apps/web' })).toBe('C:\\p\\apps\\web');
        expect(launchCwdOf('C:\\p', { cwd: 'D:\\elsewhere\\' })).toBe('D:\\elsewhere');
        expect(launchCwdOf('C:\\p', { cwd: 'C:\\' })).toBe('C:\\');
        expect(launchCwdOf('C:\\p', { cwd: '..\\q' })).toBe('C:\\q');
    });
});

describe('what a launch lacks', () => {
    test('a group needs launches and anything else a command', () => {
        expect(launchGap({ kind: 'group', launches: [] })).toBe('members');
        expect(launchGap({ kind: 'group', launches: ['a'] })).toBeNull();
        expect(launchGap({ kind: 'task', command: '  ' })).toBe('command');
        expect(launchGap({ kind: 'service' })).toBe('command');
        expect(launchGap({ kind: 'service', command: 'bun dev' })).toBeNull();
    });
});
