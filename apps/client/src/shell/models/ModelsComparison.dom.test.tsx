import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelBenchmarksResult } from '@ruimte/pulsar';
import { clickOn, mount, pressKey, until, type Mounted } from '../../../testing/dom';
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
            cacheReadPrice: 0
        },
        {
            modelId: 'opus5',
            effort: 'high',
            intelligence: 50,
            coding: 75,
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

describe('benchmark comparison', () => {
    test('distinguishes a missing Code score from a model turned off by the user', async () => {
        await open();
        await clickOn(tab('Coding'));
        const model = document.querySelector('button[aria-label="Claude Opus 5.5"]')!;
        expect(model.getAttribute('aria-pressed')).toBe('true');
        expect(model.textContent).toContain('No Coding score available');
        expect(document.getElementById(model.getAttribute('aria-describedby')!)?.textContent).toBe('No Coding score available');
        expect(point('Claude Opus 5.5')).toBeNull();
        expect(point('Claude Opus 5')).not.toBeNull();
        await clickOn(model);
        expect(model.getAttribute('aria-pressed')).toBe('false');
        expect(model.textContent).toContain('Turned off');
        await clickOn(model);
        expect(model.textContent).toContain('No Coding score available');
    });

    test('switches latency metrics and compares token prices without inventing missing cache prices', async () => {
        await open();
        await clickOn(tab('Speed'));
        await clickOn(document.querySelector('button[aria-label="Speed metric"]'));
        await until(() => document.querySelectorAll('[role="option"]').length > 0);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.includes('Time to first answer')) ?? null);
        expect(point('Claude Opus 5.5')?.getAttribute('aria-label')).toContain('First answer (s)');
        await pressKey(point('Claude Opus 5.5')!, 'Enter');
        await pressKey(point('Claude Opus 5')!, 'Enter');
        const panel = document.querySelector('section[aria-label="Measurement comparison"]')!;
        expect(panel.textContent).toContain('Token prices (USD per 1M tokens)');
        const cache = [...panel.querySelectorAll('tr')].find((row) => row.querySelector('th')?.textContent === 'Cache read')!;
        expect(cache.querySelectorAll('td')[0]?.textContent).toContain('0');
        expect(cache.querySelectorAll('td')[1]?.textContent).toBe('n/a');
        const latency = [...panel.querySelectorAll('tr')].find((row) => row.querySelector('th')?.textContent === 'First answer (s)')!;
        expect(latency.querySelectorAll('td')[2]?.textContent).toBe('0.4×');
        await clickOn(document.querySelector('button[aria-label="Clear comparison"]'));
        await clickOn(tab('Evaluation cost'));
        expect(page!.host.textContent).toContain('Cost of the full Artificial Analysis Intelligence Index evaluation.');
    });

    test('still renders an older cached response without latency or prices', async () => {
        await open({ ...RESULT, measurements: undefined });
        await pressKey(point('Claude Opus 5.5')!, 'Enter');
        const panel = document.querySelector('section[aria-label="Measurement comparison"]')!;
        expect(panel.textContent).toContain('Cost per task');
        expect(panel.textContent).not.toContain('Token prices');
        expect(panel.textContent).not.toContain('First answer (s)');
    });
});
