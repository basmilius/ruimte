import { afterAll, afterEach } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverContract, ID } from '../../../../extensions/poc-contract/contract/server.ts';
import { ExtensionHost } from './extension-host.ts';
import { runMachineAction } from './machine-actions.ts';
import { packExtension } from './pack.ts';
import { extensionFailureOf } from './refusal.ts';
import { ExtensionStore } from './store.ts';

const PROBE = join(import.meta.dir, '..', '..', '..', '..', 'extensions', 'poc-contract');
const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-extension-contract-'));
const hosts: ExtensionHost[] = [];
let worlds = 0;

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/* The machine's own host with `poc.contract` packed under these permissions, in a process of its own. */
serverContract(async (permissions) => {
    worlds += 1;

    const folder = join(root, `probe-${worlds}`);
    const manifest = JSON.parse(readFileSync(join(PROBE, 'manifest.json'), 'utf8')) as object;

    cpSync(join(PROBE, 'server'), join(folder, 'server'), { recursive: true });
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest, permissions }));

    const store = new ExtensionStore(join(root, `home-${worlds}`));
    const host = new ExtensionHost({
        store,
        asks: () => ({ 'chats.send': async () => undefined }),
        runAction: (_id, _projectId, action, input) =>
            runMachineAction(action, input, async (name, given) => {
                if (name !== 'launch.start') {
                    throw new Error(`No ${name} here`);
                }

                const { launch } = given as { launch: string };

                return { launchId: launch, name: launch } as never;
            })
    });
    const { path } = await packExtension(folder);

    hosts.push(host);
    await host.install(readFileSync(path).toString('base64'));

    const call = async (method: string, ...args: unknown[]) => {
        try {
            return { ok: true as const, value: await host.call(ID, method, args) };
        } catch (e) {
            const { code, message } = extensionFailureOf(e);

            return { ok: false as const, error: { code: code === 'invalid-input' ? 'failed' : code, message } };
        }
    };

    return {
        call,
        fire: (name, payload) => host.forwardEvent(name, payload),
        async tool(id, input, caller) {
            // A tool is listed once its process said so, which it does as it starts.
            await call('heard');

            return host.runAgentTool(`${ID}/${id}`, input, { caller });
        },
        logs: async () =>
            readFileSync(store.logFile(ID), 'utf8')
                .split('\n')
                .filter((line) => line !== '')
    };
});
