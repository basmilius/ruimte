import { describe, expect, test } from 'bun:test';
import { classifyEntry, isBuildOutput, isOsNoise } from './visibility.ts';

describe('classifyEntry', () => {
    test('rubbish the operating system keeps to itself is never listed', () => {
        for (const name of ['.DS_Store', '.ds_store', '._resource', 'Thumbs.db', 'desktop.ini', '.Trash-1000', '.nfs0a3f', 'System Volume Information']) {
            expect(classifyEntry(name, { inRepository: true })).toBe('never');
        }
        expect(isOsNoise('.DS_Store')).toBe(true);
        expect(isOsNoise('.env')).toBe(false);
    });

    test('what a tool keeps in the folder is out of every listing', () => {
        expect(classifyEntry('.ruimte', { inRepository: true })).toBe('never');
        expect(classifyEntry('.git', { inRepository: true })).toBe('never');
    });

    test('inside a repository a dot is no longer a reason to hide', () => {
        for (const name of ['.github', '.claude', '.editorconfig', '.gitignore', '.vscode', 'package.json']) {
            expect(classifyEntry(name, { inRepository: true })).toBe('always');
        }
    });

    test('what git ignores waits until a person asks for everything', () => {
        expect(classifyEntry('secrets.env', { inRepository: true, ignored: true })).toBe('shy');
        expect(classifyEntry('secrets.env', { inRepository: true })).toBe('always');
    });

    test('build output is known by name, so a folder without a repository reads the same', () => {
        for (const name of ['node_modules', 'dist', 'DerivedData', '__pycache__', '.idea']) {
            expect(classifyEntry(name, { inRepository: true })).toBe('shy');
            expect(isBuildOutput(name)).toBe(true);
        }
    });

    test('outside a repository a dot falls back to meaning hidden', () => {
        expect(classifyEntry('.github')).toBe('shy');
        expect(classifyEntry('README.md')).toBe('always');
    });
});
