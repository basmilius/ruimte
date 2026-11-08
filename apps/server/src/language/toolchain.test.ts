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

    it('asks `swift` beside sourcekit-lsp for the Swift version, since the server prints none', () => {
        const { program, args, parse } = toolchainVersionSpecOf('swift');

        expect([program, args]).toEqual(['swift', ['--version']]);
        expect(
            parse(['swift-driver version: 1.168.6 Apple Swift version 6.4 (swiftlang-6.4.0.34.1 clang-2100.3.34.1)', 'Target: arm64-apple-macosx27.3.0'])
        ).toBe('6.4');
        expect(parse(['Swift version 6.0.3 (swift-6.0.3-RELEASE)'])).toBe('6.0.3');
        expect(parse(['error: no developer tools'])).toBeNull();
        expect(isToolchainKind('swift')).toBe(true);
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
