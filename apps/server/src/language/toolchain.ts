import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';

/*
 * A kind whose server comes with a toolchain a person installs, and which Ruimte only finds: rust-analyzer
 * is a component of rustup, and has to match the toolchain a project builds with, so Ruimte pins no
 * version of it and downloads nothing. Install looks for it again, and says how to get it when it is not there.
 */
export type ToolchainKind = 'rust' | 'go' | 'swift' | 'zig';

const TOOLCHAIN_KINDS: readonly ToolchainKind[] = ['rust', 'go', 'swift', 'zig'];

export function isToolchainKind(kind: LanguageServerKind): kind is ToolchainKind {
    return (TOOLCHAIN_KINDS as readonly string[]).includes(kind);
}

interface ToolchainSpec {
    program: string;
    /* What the language status says while the program is not on this machine. */
    missing: string;
    /* Folders besides the PATH where the program may be, and which join the PATH it runs with: a daemon started by the desktop app or a service may not have them. */
    folders(): string[];
    /* How the program names its version: the program to run (a sibling of the server when it is not the server itself), its arguments, and the version in what it prints. */
    version: { program?: string; args: string[]; parse(lines: readonly string[]): string | null };
}

/* rustup's own folder. */
export function cargoBin(): string {
    return join(homedir(), '.cargo', 'bin');
}

/* The folder `go install` puts a program in: `GOBIN`, else `bin` of the first `GOPATH`, else `~/go/bin`. */
function goBin(): string {
    const gobin = process.env.GOBIN;

    if (gobin !== undefined && gobin !== '') {
        return gobin;
    }

    const gopath = process.env.GOPATH?.split(delimiter).find((entry) => entry !== '');

    return join(gopath ?? join(homedir(), 'go'), 'bin');
}

/* The version a program printed for `--version`, such as `1.85.0 (4d91de4e 2025-02-17)` out of `rust-analyzer 1.85.0 (4d91de4e 2025-02-17)`. */
export function toolchainVersionOf(program: string, lines: readonly string[]): string | null {
    const line = lines.map((text) => text.trim()).find((text) => text.startsWith(`${program} `));
    return line === undefined ? null : line.slice(program.length + 1).trim();
}

const TOOLCHAINS: Record<ToolchainKind, ToolchainSpec> = {
    rust: {
        program: 'rust-analyzer',
        missing: 'rust-analyzer is not on this machine. It comes with the Rust toolchain: run rustup component add rust-analyzer',
        folders: () => [cargoBin()],
        version: { args: ['--version'], parse: (lines) => toolchainVersionOf('rust-analyzer', lines) }
    },
    go: {
        program: 'gopls',
        missing: 'gopls is not on this machine. It comes with Go: run go install golang.org/x/tools/gopls@latest',
        // `go` itself has to be on the PATH of gopls, and Go's installers and Homebrew put it in different places.
        folders: () => [goBin(), '/usr/local/go/bin', '/opt/homebrew/bin', '/usr/local/bin'],
        version: {
            args: ['version'],
            // The first line is `golang.org/x/tools/gopls v0.18.1`.
            parse: (lines) =>
                lines
                    .map((text) => text.trim())
                    .find((text) => text.startsWith('golang.org/x/tools/gopls '))
                    ?.split(' ')[1] ?? null
        }
    },
    zig: {
        program: 'zls',
        missing: 'zls is not on this machine. Install the zls that matches your Zig version, for example with Homebrew: brew install zls',
        // zls has to match the Zig a project builds with, and runs `zig`, so both are found in the same places.
        folders: () => ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.zvm', 'bin')],
        // It prints only the version, such as `0.14.0`.
        version: { args: ['--version'], parse: (lines) => lines.map((text) => text.trim()).find((text) => /^\d+\.\d+\.\d+/.test(text)) ?? null }
    },
    swift: {
        program: 'sourcekit-lsp',
        missing: 'sourcekit-lsp is not on this machine. It comes with the Swift toolchain: install Xcode, or Swift from swift.org',
        // The server itself prints no version, so `swift` beside it is asked. On macOS the toolchain of Xcode and of the command line tools sit apart from the PATH of an app.
        folders: () => [
            '/usr/bin',
            '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
            '/Library/Developer/CommandLineTools/usr/bin',
            join(homedir(), '.swiftly', 'bin')
        ],
        version: {
            program: 'swift',
            args: ['--version'],
            // `Apple Swift version 6.0.3 (swiftlang-6.0.3.1.10 clang-1600.0.30.1)` or `Swift version 6.0.3 (swift-6.0.3-RELEASE)`.
            parse: (lines) => lines.map((text) => /Swift version (\S+)/.exec(text)?.[1]).find((version) => version !== undefined) ?? null
        }
    }
};

export function toolchainProgramOf(kind: ToolchainKind): string {
    return TOOLCHAINS[kind].program;
}

export function toolchainMissingOf(kind: ToolchainKind): string {
    return TOOLCHAINS[kind].missing;
}

export function toolchainVersionSpecOf(kind: ToolchainKind): ToolchainSpec['version'] {
    return TOOLCHAINS[kind].version;
}

/* The PATH a toolchain's program runs with, so rust-analyzer finds cargo where rustup put it and gopls finds go. */
export function toolchainPath(kind: ToolchainKind = 'rust'): string {
    return [process.env.PATH ?? '', ...TOOLCHAINS[kind].folders()].join(delimiter);
}

export function toolchainCandidates(program: string): string[] {
    const onPath = Bun.which(program, { PATH: process.env.PATH ?? '' });
    const folders =
        Object.values(TOOLCHAINS)
            .find((spec) => spec.program === program)
            ?.folders() ?? [];

    return [...new Set([...(onPath === null ? [] : [onPath]), ...folders.map((folder) => join(folder, program))])];
}
