/*
 * What `ruimte extension test` preloads into `bun test`: the modules Ruimte supplies at run time, since npm only has
 * their types. It is bundled into `generated/test-runtime.js`, which the CLI carries as text, so a test runs `server/`
 * on the same API and policy as the machine. Each module is held to its public types.
 */
import { plugin } from 'bun';
import { afterAll, afterEach } from 'bun:test';
import type * as PublicServer from '../../../../packages/extension/server';
import type * as PublicTesting from '../../../../packages/extension/testing';
import { unmountAll } from './test-dom.ts';
import { uiModule } from './test-react.ts';
import { client, createTestHost } from './test-hosts.ts';
import { createTestServer, currentServer, refusal, removeTestFolders } from './test-server.ts';

type Server = typeof PublicServer;

/* A function of `@ruimte/extension/server`, which an extension imports once, calling the test server of the moment. */
function through<Name extends keyof Server>(name: Name): Server[Name] {
    return ((...args: unknown[]) => (currentServer()[name] as (...values: unknown[]) => unknown)(...args)) as Server[Name];
}

/* An object of it, the same way. */
function forwarded<Name extends keyof Server>(name: Name): Server[Name] {
    return new Proxy({} as Server[Name] & object, {
        get: (_target, key) => {
            const target = currentServer()[name] as object;
            const value: unknown = Reflect.get(target, key);

            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

const server = {
    defineServer: through('defineServer'),
    onEvent: through('onEvent'),
    emit: through('emit'),
    defineNodeContext: through('defineNodeContext'),
    defineAgentTool: through('defineAgentTool'),
    schedule: through('schedule'),
    defineLanguageServer: through('defineLanguageServer'),
    agents: forwarded('agents'),
    chats: forwarded('chats'),
    storage: forwarded('storage'),
    secrets: forwarded('secrets'),
    machine: forwarded('machine'),
    log: forwarded('log')
} satisfies Server;

const testing = { createTestHost, createTestServer, refusal } satisfies typeof PublicTesting;

// What a test drew leaves the page with it.
afterEach(unmountAll);
afterAll(removeTestFolders);

plugin({
    name: 'ruimte-extension-fakes',
    setup(build) {
        build.module('@ruimte/extension/client', () => ({ exports: client, loader: 'object' }));
        build.module('@ruimte/extension/server', () => ({ exports: server, loader: 'object' }));
        build.module('@ruimte/extension/testing', () => ({ exports: testing, loader: 'object' }));
        // What a pack hands an extension in Ruimte, loaded only when a test imports it.
        build.module('@ruimte/extension/ui', () => ({ exports: uiModule(), loader: 'object' }));
    }
});
