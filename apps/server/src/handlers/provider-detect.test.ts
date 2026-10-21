import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProviderInfo, ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { PROVIDER_DETECT_INTERVAL_MS, registerProviderDetectHandler } from './provider-detect.ts';

const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

let dispatcher: Dispatcher;
let clock: number;
let probes: string[];
let grokInstalled: boolean;
let accountChecks: number;

beforeEach(() => {
    clock = 1_000_000;
    probes = [];
    grokInstalled = false;
    accountChecks = 0;
    const providers = new ProviderRegistry({
        detect: async (command) => {
            probes.push(command);
            return command === 'grok' ? { installed: grokInstalled, version: grokInstalled ? '1.0.0' : null } : { installed: false, version: null };
        }
    });
    dispatcher = new Dispatcher();
    const accounts = {
        refresh: async () => {
            accountChecks += 1;
        }
    };
    registerProviderDetectHandler(dispatcher, providers, accounts, () => clock);
});

async function detect(): Promise<ProviderInfo[]> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle(
        { id: 'client-1', access: GUEST, send: (frame) => frames.push(frame) },
        JSON.stringify({ id: 'r1', type: 'provider.detect', payload: {} })
    );
    const frame = frames.at(-1) as { ok: boolean; result: { providers: ProviderInfo[] } };
    expect(frame.ok).toBe(true);
    return frame.result.providers;
}

function grokOf(providers: ProviderInfo[]): boolean {
    return providers.find((provider) => provider.kind === 'grok')?.installed === true;
}

describe('provider.detect', () => {
    test('probes again at most once per interval and answers from what it found in between', async () => {
        expect(grokOf(await detect())).toBe(false);
        const first = probes.length;
        expect(first).toBeGreaterThan(0);

        grokInstalled = true;
        clock += PROVIDER_DETECT_INTERVAL_MS - 1;
        expect(grokOf(await detect())).toBe(false);
        expect(probes.length).toBe(first);

        clock += 1;
        expect(grokOf(await detect())).toBe(true);
        expect(probes.length).toBe(first * 2);
    });

    test('checks the accounts again whenever it probes, so a login made meanwhile shows', async () => {
        await detect();
        expect(accountChecks).toBe(1);
        clock += PROVIDER_DETECT_INTERVAL_MS - 1;
        await detect();
        expect(accountChecks).toBe(1);
        clock += 1;
        await detect();
        expect(accountChecks).toBe(2);
    });
});
