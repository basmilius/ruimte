import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { cargoExecutables, rustProfileDirectory, rustServerExecutable, rustTargetDirectory, rustWorkspaceBuildArguments } from './rust-build';

describe('Rust workspace build paths', () => {
    test('selects the server and context packages from the root manifest', () => {
        expect(rustWorkspaceBuildArguments('/repo', 'dev')).toEqual([
            'build',
            '--manifest-path',
            resolve('/repo/Cargo.toml'),
            '--package',
            'ruimte_server',
            '--bin',
            'ruimte-server',
            '--package',
            'ruimte_cli',
            '--bin',
            'ruimte-context',
            '--message-format=json-render-diagnostics'
        ]);
        expect(rustWorkspaceBuildArguments('/repo', 'fast').slice(-2)).toEqual(['--profile', 'fast']);
    });

    test('resolves default, custom target and profile output paths', () => {
        expect(rustTargetDirectory('/repo', {})).toBe(resolve('/repo/apps/server-rust/target'));
        expect(rustTargetDirectory('/repo', { CARGO_TARGET_DIR: 'scratch/cargo' })).toBe(resolve('/repo/scratch/cargo'));
        expect(rustTargetDirectory('/repo', { CARGO_TARGET_DIR: '/tmp/ruimte-target' })).toBe('/tmp/ruimte-target');
        expect(rustProfileDirectory('dev')).toBe('debug');
        expect(rustProfileDirectory('release')).toBe('release');
        expect(rustProfileDirectory('fast')).toBe('fast');
        expect(rustProfileDirectory('test')).toBe('debug');
        expect(rustServerExecutable('/repo', 'fast', { CARGO_TARGET_DIR: 'scratch/cargo' })).toBe(resolve('/repo/scratch/cargo/fast/ruimte-server'));
        expect(rustServerExecutable('/repo', 'release', { CARGO_BUILD_TARGET: 'aarch64-apple-darwin' })).toBe(
            resolve('/repo/apps/server-rust/target/aarch64-apple-darwin/release/ruimte-server')
        );
    });

    test('reads executable paths from Cargo artifact metadata', () => {
        const messages = [
            JSON.stringify({ reason: 'compiler-artifact', target: { name: 'ruimte-server' }, executable: '/custom/server' }),
            JSON.stringify({ reason: 'compiler-artifact', target: { name: 'ruimte-context' }, executable: '/custom/context' }),
            JSON.stringify({ reason: 'build-finished', success: true })
        ].join('\n');
        expect([...cargoExecutables(messages)]).toEqual([
            ['ruimte-server', '/custom/server'],
            ['ruimte-context', '/custom/context']
        ]);
    });
});
