import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { cargoBin, isToolchainKind, toolchainCandidates, toolchainPath, toolchainVersionOf, toolchainVersionSpecOf } from './toolchain.ts';

describe('toolchain kinds', () => {
    it('knows the kinds a toolchain brings', () => {
        expect(isToolchainKind('rust')).toBe(true);
        expect(isToolchainKind('go')).toBe(true);
        expect(isToolchainKind('php-native')).toBe(false);
        expect(isToolchainKind('markdown')).toBe(false);
    });

    it('looks for a program in the folders of its own toolchain, and adds them to the PATH it runs with', () => {
        expect(toolchainCandidates('rust-analyzer')).toContain(join(cargoBin(), 'rust-analyzer'));
        expect(toolchainCandidates('rust-analyzer')).not.toContain(join(homedir(), 'go', 'bin', 'rust-analyzer'));
        expect(toolchainCandidates('gopls')).toContain(join('/usr/local/go/bin', 'gopls'));
        expect(toolchainPath('rust').split(delimiter)).toContain(cargoBin());
        expect(toolchainPath('go').split(delimiter)).toContain('/usr/local/go/bin');
        expect(toolchainCandidates('something-else')).not.toContain(join(cargoBin(), 'something-else'));
    });

    it('reads the version gopls prints for its version command', () => {
        const { args, parse } = toolchainVersionSpecOf('go');

        expect(args).toEqual(['version']);
        expect(parse(['golang.org/x/tools/gopls v0.18.1', '    golang.org/x/tools/gopls@v0.18.1 h1:abc='])).toBe('v0.18.1');
        expect(parse(['usage: gopls [flags] <command>'])).toBeNull();
    });

    it('reads the version a program names itself with, and nothing from a proxy without its component', () => {
        expect(toolchainVersionOf('rust-analyzer', ['rust-analyzer 1.85.0 (4d91de4e 2025-02-17)'])).toBe('1.85.0 (4d91de4e 2025-02-17)');
        expect(toolchainVersionOf('rust-analyzer', ["error: Unknown binary 'rust-analyzer' in official toolchain 'stable'."])).toBeNull();
        expect(toolchainVersionOf('rust-analyzer', [])).toBeNull();
    });
});
