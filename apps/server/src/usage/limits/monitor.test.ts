import { describe, expect, test } from 'bun:test';
import type { UsageProvider } from '@ruimte/contracts';
import { ProviderRegistry } from '../../providers/registry.ts';
import { UsageMonitor } from './monitor.ts';
import type { ProbeResult } from './probe.ts';

const registry = (installed: readonly UsageProvider[]): ProviderRegistry =>
    new ProviderRegistry({ detect: (command) => Promise.resolve({ installed: installed.includes(command as UsageProvider), version: '1.0.0' }) });

const reading = (used: number): ProbeResult => ({
    plan: 'max',
    windows: [{ id: 'five_hour', kind: 'session', label: 'Session', used, resetsAt: 1_000, durationMs: 5 * 60 * 60_000 }],
    cost: null
});

const providerOf = (monitor: UsageMonitor, kind: UsageProvider) => monitor.snapshot().providers.find((provider) => provider.kind === kind)!;

describe('the usage monitor', () => {
    test('reads every installed CLI and says so about the ones that are not there', async () => {
        const monitor = new UsageMonitor({ providers: registry(['claude']), probe: () => Promise.resolve(reading(0.23)) });
        await monitor.refresh(true);
        expect(providerOf(monitor, 'claude')).toMatchObject({ plan: 'max', source: 'probe', unavailable: null });
        expect(providerOf(monitor, 'codex').unavailable).toEqual({ reason: 'not-installed', message: null });
        monitor.stop();
    });

    test('tells every subscribed client when a number moved', async () => {
        const seen: string[] = [];
        const monitor = new UsageMonitor({ providers: registry(['claude']), probe: () => Promise.resolve(reading(0.23)) });
        monitor.subscribe('client-1', (event) => seen.push(event.event));
        await monitor.refresh(true);
        expect(seen).toEqual(['usage.limitsChanged']);
        monitor.stop();
    });

    test('a turn moves the bar the read drew, keeping its reset', async () => {
        const monitor = new UsageMonitor({ providers: registry(['claude']), probe: () => Promise.resolve(reading(0.23)) });
        await monitor.refresh(true);
        monitor.applyLive({ kind: 'claude', windows: [{ id: 'five_hour', used: 0.42 }] });
        const claude = providerOf(monitor, 'claude');
        expect(claude.source).toBe('event');
        expect(claude.windows[0]).toMatchObject({ used: 0.42, resetsAt: 1_000, label: 'Session' });
        monitor.stop();
    });

    test('a read that failed leaves the last good numbers up and waits longer next time', async () => {
        let answer: ProbeResult = reading(0.23);
        const monitor = new UsageMonitor({ providers: registry(['claude']), probe: () => Promise.resolve(answer) });
        await monitor.refresh(true);
        answer = { unavailable: { reason: 'failed', message: 'Claude Code did not answer in time' } };
        await monitor.refresh(true);
        expect(providerOf(monitor, 'claude').windows[0]).toMatchObject({ used: 0.23 });
        expect(providerOf(monitor, 'claude').unavailable).toBeNull();
        monitor.stop();
    });

    test('an account without a plan says so instead of showing nothing', async () => {
        const monitor = new UsageMonitor({
            providers: registry(['claude']),
            probe: () => Promise.resolve({ unavailable: { reason: 'no-subscription', message: null } })
        });
        await monitor.refresh(true);
        expect(providerOf(monitor, 'claude')).toMatchObject({ windows: [], unavailable: { reason: 'no-subscription' } });
        monitor.stop();
    });

    test('two callers at once share one pass', async () => {
        let passes = 0;
        const monitor = new UsageMonitor({
            providers: registry(['claude']),
            probe: () => {
                passes += 1;
                return Promise.resolve(reading(0.1));
            }
        });
        await Promise.all([monitor.refresh(true), monitor.refresh(true)]);
        expect(passes).toBe(1);
        monitor.stop();
    });
});
