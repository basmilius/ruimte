import { describe, expect, test } from 'bun:test';
import { LaunchesSharedFileSchema, launchPortOf, readLaunchEntries, type LaunchConfig } from './launches.ts';

/* The shared file from the design report, with a field and a kind a later release might add. */
const file = {
    version: 1,
    launches: [
        { id: 'full-stack', name: 'Full stack', kind: 'group', launches: ['run-server', 'dev'] },
        {
            id: 'run-server',
            name: 'Run server',
            kind: 'service',
            cwd: 'backend',
            command: 'php -S 0.0.0.0:8000 -t public dev/server.php',
            url: 'http://localhost:8000',
            env: { APP_ENV: 'development' },
            restartOnCrash: true
        },
        { id: 'deploy', name: 'Deploy', kind: 'pipeline', steps: ['build', 'push'] }
    ]
};

describe('the launches file', () => {
    test('an unknown field and an unknown kind are written back unchanged', () => {
        const parsed = LaunchesSharedFileSchema.parse(JSON.parse(JSON.stringify(file)));
        const entries = readLaunchEntries(parsed.launches);
        expect(entries.map((entry) => ('launch' in entry ? entry.launch.id : 'raw'))).toEqual(['full-stack', 'run-server', 'raw']);
        const written = { ...parsed, launches: entries.map((entry) => ('launch' in entry ? entry.launch : entry.raw)) };
        expect(JSON.parse(JSON.stringify(written))).toEqual(file);
    });

    test('a launch keeps a field it does not know', () => {
        const [entry] = readLaunchEntries([file.launches[1]]);
        const launch = (entry as { launch: LaunchConfig }).launch;
        expect(launch.restartOnCrash).toBe(true);
    });
});

describe('the port of an address', () => {
    test('reads the port, or the one the scheme implies', () => {
        expect(launchPortOf('http://localhost:8000')).toBe(8000);
        expect(launchPortOf('http://localhost')).toBe(80);
        expect(launchPortOf('https://example.test/path')).toBe(443);
        expect(launchPortOf('not an address')).toBeNull();
        expect(launchPortOf(undefined)).toBeNull();
    });
});
