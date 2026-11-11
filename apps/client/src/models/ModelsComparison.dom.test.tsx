import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelBenchmarksResult } from '@ruimte/pulsar';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { typeInto } from '../../testing/dom-helpers';
import { ModelsComparison } from './ModelsComparison';

const RESULT: ModelBenchmarksResult = {
    fetchedAt: 123,
    labs: [{ id: 'claude', name: 'Anthropic', logo: { viewBox: '0 0 24 24', path: 'M0 0h24v24H0z' }, colors: { light: ['#a00000'], dark: ['#f00000'] } }],
    models: [
        { id: 'opus55', name: 'Claude Opus 5.5', provider: 'claude', legacy: false, points: [{ effort: 'high', intelligence: 55, costPerTask: 1 }] },
        { id: 'opus5', name: 'Claude Opus 5', provider: 'claude', legacy: false, points: [{ effort: 'high', intelligence: 50, costPerTask: 2 }] }
    ],
    measurements: [
        {
            modelId: 'opus55',
            effort: 'high',
            intelligence: 55,
            costPerTask: 1,
            outputSpeed: 90,
            timeToFirstAnswer: 5,
            responseTime: 11,
            inputPrice: 4,
            outputPrice: 20,
            cacheReadPrice: 0,
            releaseDate: '2026-02-05'
        },
        {
            modelId: 'opus5',
            effort: 'high',
            intelligence: 50,
            engineering: 75,
            costPerTask: 2,
            outputSpeed: 60,
            timeToFirstAnswer: 2,
            responseTime: 10,
            inputPrice: 5,
            outputPrice: 25
        }
    ]
};

let page: Mounted | undefined;

afterEach(async () => {
    await page?.unmount();
    page = undefined;
});

async function open(result = RESULT): Promise<void> {
    page = mount();
    await page.render(<ModelsComparison result={result} />);
}

function tab(label: string): Element | null {
    return [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent === label) ?? null;
}

function point(name: string): Element | null {
    return [...document.querySelectorAll('svg [role="button"]')].find((element) => element.getAttribute('aria-label')?.startsWith(name + ',')) ?? null;
}

function chart(): Element {
    return document.querySelector('svg[aria-roledescription="chart"]')!;
}

/* What the keyboard is on: the chart is one tab stop and names its point through the active descendant. */
function current(): string | null {
    const id = chart().getAttribute('aria-activedescendant');
    return id === null ? null : (document.getElementById(id)?.getAttribute('aria-label') ?? null);
}

async function moveTo(name: string, key: 'ArrowRight' | 'ArrowDown'): Promise<void> {
    for (let step = 0; step < 10 && !current()?.startsWith(name + ','); step++) {
        await pressKey(chart(), key);
    }
    expect(current()).toStartWith(name + ',');
}

async function pick(name: string, key: 'ArrowRight' | 'ArrowDown' = 'ArrowDown'): Promise<void> {
    await moveTo(name, key);
    await pressKey(chart(), 'Enter');
}

function pressed(): string[] {
    return [...document.querySelectorAll('svg [role="button"][aria-pressed="true"]')].map((element) => element.getAttribute('aria-label') ?? '');
}

function status(): string {
    return document.querySelector('p[role="status"]')?.textContent ?? '';
}

describe('benchmark comparison', () => {
    test('bar axes keep the selected models full range when their maximum effort is hidden', async () => {
        await open({
            ...RESULT,
            measurements: [...RESULT.measurements!, { modelId: 'opus55', effort: 'max', intelligence: 95, costPerTask: 10 }]
        });
        for (const [view, ceiling] of [
            ['Intelligence', '100'],
            ['Cost per task', '$10']
        ] as const) {
            await clickOn(tab(view));
            expect(chart().getAttribute('aria-label')).toBe(view);
            // The value axis writes its ticks end-aligned beside the plot; value labels stand centered over their columns.
            const ticks = (): string[] =>
                [...document.querySelectorAll('[role="tabpanel"] text[text-anchor="end"]')].map((element) => element.textContent ?? '');
            expect(ticks()).toContain(ceiling);
            expect(chart().querySelectorAll('[role="button"]')).toHaveLength(3);
            const maximum = [...document.querySelectorAll('fieldset button')].find((element) => element.textContent === 'max')!;
            expect(maximum.getAttribute('aria-pressed')).toBe('true');
            await clickOn(maximum);
            expect(maximum.getAttribute('aria-pressed')).toBe('false');
            expect(chart().querySelectorAll('[role="button"]')).toHaveLength(2);
            expect([...chart().querySelectorAll('[role="button"]')].some((element) => element.getAttribute('aria-label')?.includes('Max'))).toBe(false);
            expect(ticks()).toContain(ceiling);
            await clickOn(maximum);
        }
    });

    test('a ranked list lays its bars out as rows with the name of each beside it, and Down walks them', async () => {
        await open();
        await clickOn(tab('Intelligence'));
        await clickOn([...document.querySelectorAll('[role="radio"], button')].find((element) => element.textContent === 'Ranked') ?? null);
        const labels = [...document.querySelectorAll('[role="tabpanel"] text')].map((element) => element.textContent ?? '');
        expect(labels).toEqual(expect.arrayContaining(['Claude Opus 5.5 · High', 'Claude Opus 5 · High']));
        expect(document.querySelector('[role="tabpanel"] text[transform*="rotate"]')).toBeNull();

        await pick('Claude Opus 5', 'ArrowDown');
        expect(pressed()).toEqual(['Claude Opus 5, High, Intelligence Index 50']);
    });

    test('distinguishes a missing Engineering score from a model turned off by the user', async () => {
        await open();
        await clickOn(tab('Engineering'));
        const model = document.querySelector('button[aria-label="Claude Opus 5.5"]')!;
        expect(model.getAttribute('aria-pressed')).toBe('true');
        expect(model.textContent).toContain('No Engineering score available');
        expect(document.getElementById(model.getAttribute('aria-describedby')!)?.textContent).toBe('No Engineering score available');
        expect(point('Claude Opus 5.5')).toBeNull();
        expect(point('Claude Opus 5')).not.toBeNull();
        await clickOn(model);
        expect(model.getAttribute('aria-pressed')).toBe('false');
        expect(model.textContent).toContain('Turned off');
        await clickOn(model);
        expect(model.textContent).toContain('No Engineering score available');
    });

    test('switches latency metrics and compares token prices without inventing missing cache prices', async () => {
        await open();
        await clickOn(tab('Speed'));
        await clickOn(document.querySelector('button[aria-label="Speed metric"]'));
        await until(() => document.querySelectorAll('[role="option"]').length > 0);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.includes('Time to first answer')) ?? null);
        expect(point('Claude Opus 5.5')?.getAttribute('aria-label')).toContain('First answer (s)');
        await pick('Claude Opus 5.5');
        await pick('Claude Opus 5');
        const panel = document.querySelector('section[aria-label="Measurement comparison"]')!;
        expect(panel.textContent).toContain('Token prices (USD per 1M tokens)');
        const cache = [...panel.querySelectorAll('tr')].find((row) => row.querySelector('th')?.textContent === 'Cache read')!;
        expect(cache.querySelectorAll('td')[0]?.textContent).toContain('0');
        expect(cache.querySelectorAll('td')[1]?.textContent).toBe('n/a');
        const latency = [...panel.querySelectorAll('tr')].find((row) => row.querySelector('th')?.textContent === 'First answer (s)')!;
        expect(latency.querySelectorAll('td')[2]?.textContent).toBe('0.4×');
        const released = [...panel.querySelectorAll('tr')].find((row) => row.querySelector('th')?.textContent === 'Released')!;
        expect(released.querySelectorAll('td')[0]?.textContent).toContain('2026');
        expect(released.querySelectorAll('td')[1]?.textContent).toBe('n/a');
        await clickOn(document.querySelector('button[aria-label="Clear comparison"]'));
        await clickOn(tab('Evaluation cost'));
        expect(page!.host.textContent).toContain('Cost of the full Artificial Analysis Intelligence Index evaluation.');
    });

    test('still renders an older cached response without latency or prices', async () => {
        await open({ ...RESULT, measurements: undefined });
        await pick('Claude Opus 5.5');
        const panel = document.querySelector('section[aria-label="Measurement comparison"]')!;
        expect(panel.textContent).toContain('Cost per task');
        expect(panel.textContent).not.toContain('Token prices');
        expect(panel.textContent).not.toContain('First answer (s)');
    });

    test('compares a pinned column with the one the keyboard is on, and one Escape clears both', async () => {
        await open();
        await clickOn(tab('Intelligence'));
        await pick('Claude Opus 5.5', 'ArrowRight');
        expect(pressed()).toEqual(['Claude Opus 5.5, High, Intelligence Index 55']);
        await moveTo('Claude Opus 5', 'ArrowRight');
        expect(pressed()).toHaveLength(2);
        const rules = (): string[] => [...document.querySelectorAll('[role="tabpanel"] text')].map((element) => element.textContent ?? '');
        expect(rules()).toEqual(expect.arrayContaining(['A · 55', 'B · 50']));
        const reached: string[] = [];
        const listen = (e: KeyboardEvent): void => {
            reached.push(e.key);
        };
        document.addEventListener('keydown', listen);
        await pressKey(chart(), 'Escape');
        document.removeEventListener('keydown', listen);
        expect(pressed()).toEqual([]);
        expect(rules()).not.toContain('A · 55');
        expect(status()).toBe('Comparison cleared.');
        // The dialog around the chart closes on an Escape that reaches the document.
        expect(reached).toEqual([]);
    });

    test('turning a lab off with None clears the reference it held and says why', async () => {
        await open();
        await pick('Claude Opus 5.5');
        expect(pressed()).toHaveLength(1);
        const legend = document.querySelector('aside')!;
        await clickOn([...legend.querySelectorAll('button')].find((element) => element.textContent === 'None') ?? null);
        expect(legend.querySelector('button[aria-label="Claude Opus 5.5"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(legend.querySelector('button[aria-label="Claude Opus 5"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(status()).toBe('A filter hid the reference, so the comparison was cleared.');
    });

    test('the search above the legend narrows its models', async () => {
        await open();
        const legend = document.querySelector('aside')!;
        const search = legend.querySelector<HTMLInputElement>('input[placeholder="Find models"]')!;
        const models = (): string[] =>
            [...legend.querySelectorAll('[role="group"] button[aria-pressed][aria-label]')].map((element) => element.getAttribute('aria-label') ?? '');
        expect(models()).toEqual(['Claude Opus 5.5', 'Claude Opus 5']);
        await typeInto(search, '5.5');
        expect(models()).toEqual(['Claude Opus 5.5']);
        await typeInto(search, 'gemini');
        expect(models()).toEqual([]);
        expect(legend.textContent).toContain('No models found.');
    });
});
