import { describe, expect, test } from 'bun:test';
import type { UsageProvider } from '@ruimte/agent-contracts';
import { ProviderRegistry } from '../../providers/registry.ts';
import { UsageMonitor, type LimitAccount, type LimitAccounts } from './monitor.ts';
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

    describe('per account', () => {
        const HOUR = 60 * 60_000;
        let now = 100 * HOUR;
        const used = new Map<string, number>();
        const accounts = (list: LimitAccount[]): LimitAccounts => ({
            list: () => list,
            envFor: (_kind, id) => ({ ACCOUNT: id }),
            lastUsedAt: (id) => used.get(id) ?? null
        });
        const claudeAccounts: LimitAccount[] = [
            { id: 'claude_work', kind: 'claude', label: 'Work', color: 'blue', isDefault: false },
            { id: 'claude', kind: 'claude', label: 'Claude Code', isDefault: true }
        ];
        const probed: string[] = [];
        const monitorOf = (list: LimitAccount[]): UsageMonitor =>
            new UsageMonitor({
                providers: registry(['claude']),
                accounts: accounts(list),
                now: () => now,
                probe: (_kind, _command, env) => {
                    probed.push(env.ACCOUNT!);
                    return Promise.resolve(reading(env.ACCOUNT === 'claude' ? 0.1 : 0.7));
                }
            });

        test('lists the default account of a CLI first, and reads another only while it was used in the last day or when asked', async () => {
            probed.length = 0;
            used.clear();
            const monitor = monitorOf(claudeAccounts);
            await monitor.refresh(false);
            expect(probed).toEqual(['claude']);
            expect(monitor.snapshot().providers.map((provider) => [provider.kind, provider.account?.id, provider.checkedAt > 0])).toEqual([
                ['claude', 'claude', true],
                ['claude', 'claude_work', false]
            ]);

            used.set('claude_work', now - 2 * HOUR);
            now += 6 * 60_000;
            await monitor.refresh(false);
            expect(probed).toEqual(['claude', 'claude', 'claude_work']);
            expect(monitor.snapshot().providers[1]).toMatchObject({ account: { id: 'claude_work', label: 'Work', color: 'blue' }, windows: [{ used: 0.7 }] });

            used.set('claude_work', now - 25 * HOUR);
            now += 6 * 60_000;
            await monitor.refresh(false);
            expect(probed.slice(3)).toEqual(['claude']);
            await monitor.refresh(true);
            expect(probed.slice(4)).toEqual(['claude', 'claude_work']);
            monitor.stop();
        });

        test('a turn moves the bar of the account it ran under', async () => {
            const monitor = monitorOf(claudeAccounts);
            await monitor.refresh(true);
            monitor.applyLive({ kind: 'claude', account: 'claude_work', windows: [{ id: 'five_hour', used: 0.9 }] });
            const [own, work] = monitor.snapshot().providers;
            expect(own).toMatchObject({ source: 'probe', windows: [{ used: 0.1 }] });
            expect(work).toMatchObject({ source: 'event', windows: [{ used: 0.9, resetsAt: 1_000 }] });
            monitor.stop();
        });

        test('says why an account could not be read', async () => {
            const monitor = new UsageMonitor({
                providers: registry(['claude']),
                accounts: {
                    ...accounts(claudeAccounts),
                    envFor: (_kind, id) => {
                        if (id === 'claude_work') {
                            throw new Error('its folder is missing');
                        }
                        return {};
                    }
                },
                probe: () => Promise.resolve(reading(0.2))
            });
            await monitor.refresh(true);
            expect(monitor.snapshot().providers[1]).toMatchObject({ unavailable: { reason: 'failed', message: 'its folder is missing' } });
            monitor.stop();
        });
    });
});
