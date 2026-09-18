import { resolve } from 'node:path';

export const rustProfileDirectory = (profile: string): string => (profile === 'dev' || profile === 'test' ? 'debug' : profile);

export const rustTargetDirectory = (repository: string, environment: NodeJS.ProcessEnv = process.env): string =>
    resolve(repository, environment.CARGO_TARGET_DIR ?? 'apps/server-rust/target');

export const rustServerExecutable = (repository: string, profile: string, environment: NodeJS.ProcessEnv = process.env): string =>
    resolve(
        rustTargetDirectory(repository, environment),
        ...(environment.CARGO_BUILD_TARGET ? [environment.CARGO_BUILD_TARGET] : []),
        rustProfileDirectory(profile),
        'ruimte-server'
    );

export const rustWorkspaceBuildArguments = (repository: string, profile: string): string[] => [
    'build',
    '--manifest-path',
    resolve(repository, 'Cargo.toml'),
    '--package',
    'ruimte_server',
    '--bin',
    'ruimte-server',
    '--package',
    'ruimte_cli',
    '--bin',
    'ruimte-context',
    '--message-format=json-render-diagnostics',
    ...(profile === 'dev' ? [] : ['--profile', profile])
];

export const cargoExecutables = (output: string): Map<string, string> => {
    const executables = new Map<string, string>();
    for (const line of output.split('\n')) {
        if (!line.startsWith('{')) {
            continue;
        }
        try {
            const message = JSON.parse(line) as { executable?: unknown; reason?: unknown; target?: { name?: unknown } };
            if (message.reason === 'compiler-artifact' && typeof message.executable === 'string' && typeof message.target?.name === 'string') {
                executables.set(message.target.name, message.executable);
            }
        } catch {
            continue;
        }
    }
    return executables;
};
