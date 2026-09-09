import { describe, expect, test } from 'bun:test';
import { defaultShell, defaultShellArgs, signalExitCode } from './pty.ts';

describe('defaultShell', () => {
    test('prefers $SHELL', () => {
        expect(defaultShell({ SHELL: '/opt/fish' }, 'darwin')).toBe('/opt/fish');
    });

    test('falls back per platform when $SHELL is missing or blank', () => {
        expect(defaultShell({}, 'darwin')).toBe('/bin/zsh');
        expect(defaultShell({ SHELL: '  ' }, 'linux')).toBe('/bin/bash');
    });
});

describe('defaultShellArgs', () => {
    test('adds the login flag only for shells known to take it', () => {
        expect(defaultShellArgs('/bin/zsh')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/local/bin/fish')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/bin/nu')).toEqual([]);
    });
});

describe('signalExitCode', () => {
    test('reports a signal death the way shells do', () => {
        expect(signalExitCode('SIGKILL', { SIGKILL: 9 })).toBe(137);
        expect(signalExitCode('SIGWEIRD', {})).toBe(128);
    });
});
