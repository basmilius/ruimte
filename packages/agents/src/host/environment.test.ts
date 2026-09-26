import { expect, test } from 'bun:test';
import { cliEnvironment } from './environment.ts';

test('an app started from a Ruimte terminal hands its CLIs nothing of that session', () => {
    const env = cliEnvironment({
        HOME: '/home/person',
        PATH: '/usr/bin',
        RUIMTE_HOOK_URL: 'http://127.0.0.1:4210/hooks',
        RUIMTE_HOOK_TOKEN: 'secret',
        RUIMTE_HOOK_LATER: 'x',
        RUIMTE_CONTEXT_URL: 'http://127.0.0.1:4210/context',
        RUIMTE_CONTEXT_TOKEN: 'secret',
        RUIMTE_SESSION_ID: 'node-1',
        RUIMTE_HOME: '/home/person/.ruimte',
        UNSET: undefined
    });
    expect(env).toEqual({ HOME: '/home/person', PATH: '/usr/bin', RUIMTE_HOME: '/home/person/.ruimte' });
});
