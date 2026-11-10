import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { useUsageStore } from '@adecore/agents-react/state';
import { UsageLimits, LimitsList, AccountLimitsList } from '@adecore/agents-react/usage';
import type { UsageLimitsSnapshot } from '@ruimte/contracts';
import { act } from 'react';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { chatScopeOf } from '@/workspace/chat-scope';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';

const NOW = Date.UTC(2026, 9, 30, 10);
const known: UsageLimitsSnapshot = {
    providers: [
        {
            kind: 'claude',
            plan: 'max',
            checkedAt: NOW - 600_000,
            source: 'probe',
            windows: [{ id: 'session', kind: 'session', label: 'Session', used: 0.3, resetsAt: null, durationMs: null }],
            cost: null,
            unavailable: { reason: 'failed', message: 'CLI unavailable' }
        }
    ]
};
let page: Mounted;
let machine: FakeMachine;
let release: () => void;

function readButton(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((button) => button.textContent === 'Read limits again');
}

beforeEach(async () => {
    setSystemTime(NOW);
    machine = new FakeMachine();
    machine.answer('usage.limits', () => known);
    release = connectFakeMachine(machine);
    page = mount();
    await page.render(<UsageLimits />);
    await until(() => document.querySelectorAll('[role="progressbar"]').length === 1);
});

afterEach(async () => {
    await page.unmount();
    release();
    useUsageStore.getState().forget(chatScopeOf(LOCAL_ENDPOINT_ID).id);
    setSystemTime();
});

describe('reading account limits from the usage section', () => {
    test('keeps failed values and their age, then serializes taps and permits retry after refusal', async () => {
        expect(page.host.textContent).toContain('Last known numbers');
        expect(page.host.textContent).toContain('May be out of date');
        expect(page.host.textContent).toContain('CLI unavailable');
        const pending = Promise.withResolvers<UsageLimitsSnapshot>();
        machine.answer('usage.refreshLimits', () => pending.promise);
        const button = readButton()!;
        await clickOn(button);
        await clickOn(button);
        expect(machine.requests('usage.refreshLimits')).toHaveLength(1);
        expect(button.disabled).toBe(true);
        await act(async () => pending.reject(new Error('Temporary read failure')));
        await until(() => page.host.textContent?.includes('Could not read limits. Try again.') === true);
        expect(page.host.querySelector('[role="alert"]')?.textContent).toBe('Could not read limits. Try again.');
        expect(page.host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
        machine.answer('usage.refreshLimits', () => ({ providers: [{ ...known.providers[0]!, checkedAt: NOW, unavailable: null }] }));
        await clickOn(readButton()!);
        await until(() => !page.host.textContent?.includes('Last known numbers'));
        expect(machine.requests('usage.refreshLimits')).toHaveLength(2);
        expect(page.host.textContent).toContain('Last updated · now');
    });

    test('rows without visible windows never claim fresh or stale numbers', async () => {
        const scope = chatScopeOf(LOCAL_ENDPOINT_ID).id;
        for (const reason of ['failed', 'no-subscription', 'not-installed'] as const) {
            await act(async () =>
                useUsageStore.getState().setLimits(scope, {
                    providers: [{ ...known.providers[0]!, checkedAt: NOW - 600_000, windows: [], unavailable: { reason, message: 'No reading' } }]
                })
            );
            expect(page.host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
            expect(page.host.textContent).not.toContain('Last updated');
            expect(page.host.textContent).not.toContain('May be out of date');
        }
    });

    test('a later snapshot clears an earlier request failure', async () => {
        machine.answer('usage.refreshLimits', () => {
            throw new Error('Technical read failure');
        });
        await clickOn(readButton()!);
        await until(() => page.host.querySelector('[role="alert"]') !== null);
        await act(async () => machine.emit('usage.limitsChanged', { providers: [{ ...known.providers[0]!, checkedAt: NOW, unavailable: null }] }));
        await until(() => page.host.querySelector('[role="alert"]') === null);
        expect(page.host.textContent).not.toContain('Last known numbers');
    });

    test('a missing initial snapshot offers an honest manual read instead of permanent loading', async () => {
        await page.unmount();
        useUsageStore.getState().forget(chatScopeOf(LOCAL_ENDPOINT_ID).id);
        const previous = machine.requests('usage.limits').length;
        machine.answer('usage.limits', () => {
            throw new Error('Snapshot unavailable');
        });
        machine.answer('usage.refreshLimits', () => ({ providers: [{ ...known.providers[0]!, unavailable: null, checkedAt: NOW }] }));
        page = mount();
        await page.render(<UsageLimits />);
        await until(() => machine.requests('usage.limits').length > previous);
        expect(page.host.textContent).toContain('No plan limits have been read.');
        expect(page.host.textContent).not.toContain('Loading limits');
        await clickOn(readButton()!);
        await until(() => page.host.querySelectorAll('[role="progressbar"]').length === 1);
        expect(page.host.textContent).not.toContain('No plan limits have been read.');
    });

    test('warns at ten minutes and tolerates small machine clock skew', async () => {
        const scope = chatScopeOf(LOCAL_ENDPOINT_ID).id;
        for (const [checkedAt, old, text] of [
            [NOW - 599_000, false, 'Last updated'],
            [NOW - 600_000, true, 'Last updated'],
            [NOW + 30_000, false, 'Last updated · now'],
            [NOW + 300_000, false, 'Update time unknown']
        ] as const) {
            await act(async () => useUsageStore.getState().setLimits(scope, { providers: [{ ...known.providers[0]!, checkedAt, unavailable: null }] }));
            expect(page.host.textContent).toContain(text);
            expect(page.host.textContent?.includes('May be out of date')).toBe(old);
        }
    });

    test('does not write a response after the page closes', async () => {
        const pending = Promise.withResolvers<UsageLimitsSnapshot>();
        machine.answer('usage.refreshLimits', () => pending.promise);
        await clickOn(readButton()!);
        await page.unmount();
        await act(async () => pending.resolve({ providers: [{ ...known.providers[0]!, checkedAt: NOW, unavailable: null }] }));
        expect(useUsageStore.getState().byScope[chatScopeOf(LOCAL_ENDPOINT_ID).id]?.limits).toEqual(known);
        page = mount();
    });

    test('disconnect disables the control and sends no forced read', async () => {
        await act(async () => machine.drop());
        await until(() => readButton()?.disabled === true);
        await clickOn(readButton()!);
        expect(machine.requests('usage.refreshLimits')).toHaveLength(0);
    });

    test('single-provider and named compact cards retain failed bars but hide no-subscription bars', async () => {
        await page.render(
            <>
                <LimitsList limits={known} now={NOW} compact />
                <AccountLimitsList
                    groups={[
                        {
                            kind: 'claude',
                            accounts: [
                                {
                                    id: 'work',
                                    kind: 'claude',
                                    name: 'Work',
                                    color: undefined,
                                    entry: known.providers[0]!,
                                    status: null
                                }
                            ]
                        }
                    ]}
                    now={NOW}
                    folded={new Set()}
                    onFoldedChange={() => undefined}
                />
            </>
        );
        expect(page.host.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
        expect(page.host.textContent?.match(/Last known numbers/g)).toHaveLength(2);
        expect(page.host.textContent?.match(/CLI unavailable/g)).toHaveLength(2);
        await page.render(
            <LimitsList limits={{ providers: [{ ...known.providers[0]!, unavailable: { reason: 'no-subscription', message: null } }] }} now={NOW} compact />
        );
        expect(page.host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    });
});
