import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import type { ModelInfo, ProviderInfo } from '@ruimte/contracts';
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

let page: Mounted;
let picked: string[];

const VENDORS = ['Qwen', 'Moonshot AI', 'DeepSeek', 'Z.ai'];

function model(index: number): ModelInfo {
    return {
        slug: `vendor/model-${String(index).padStart(2, '0')}`,
        name: `Model ${String(index).padStart(2, '0')}`,
        vendor: VENDORS[index % VENDORS.length]!,
        legacy: false,
        isDefault: index === 5,
        options: []
    } as ModelInfo;
}

function providerOf(count: number): ProviderInfo {
    return {
        kind: 'nanogpt',
        name: 'NanoGPT Subscription',
        installed: true,
        version: null,
        models: Array.from({ length: count }, (_, index) => model(index)),
        defaultModel: 'vendor/model-05',
        capabilities: { chat: true, terminal: false },
        resumeCommand: ''
    } as unknown as ProviderInfo;
}

function Harness({ count }: { count: number }) {
    const [open, setOpen] = useState(true);
    return (
        <ModelPicker
            providers={[providerOf(count)]}
            provider="nanogpt"
            selection={{ model: 'vendor/model-02', options: {} }}
            open={open}
            onOpenChange={setOpen}
            onChange={(_kind, slug) => picked.push(slug)}
        />
    );
}

function rows(): string[] {
    return [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

function groupRow(): HTMLElement | null {
    return (
        ([...document.querySelectorAll('button')] as HTMLElement[]).find((candidate) => /^Models \(\d+\)$/.test(candidate.textContent?.trim() ?? '')) ?? null
    );
}

function search(): HTMLInputElement {
    return document.querySelector<HTMLInputElement>('input[placeholder="Search models"]')!;
}

async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

beforeEach(() => {
    picked = [];
});

afterEach(async () => {
    await page.unmount();
});

describe('the model picker of a provider with many models', () => {
    test('shows the picked model and the default, and one row that says how many there are', async () => {
        page = mount();
        await page.render(<Harness count={40} />);
        await until(() => groupRow() !== null);

        expect(rows()).toEqual(['Model 02', 'Model 05']);
        expect(groupRow()!.textContent).toContain('Models (40)');
    });

    test('opens every model under it, grouped by maker with the makers in order, and closes again', async () => {
        page = mount();
        await page.render(<Harness count={40} />);
        await until(() => groupRow() !== null);

        await clickOn(groupRow());
        await until(() => rows().length === 40);
        const labels = [...document.querySelectorAll('[role="listbox"] > div > div')]
            .map((node) => node.textContent?.trim() ?? '')
            .filter((text) => VENDORS.includes(text));
        expect(labels).toEqual(['DeepSeek', 'Moonshot AI', 'Qwen', 'Z.ai']);
        // Within a maker the models read in order.
        const deepseek = rows().filter((_row, index) => index < 10);
        expect(deepseek).toEqual([...deepseek].sort());

        await clickOn(groupRow());
        await until(() => rows().length === 2);
    });

    test('a search looks through all of them without opening the row, and a pick goes to the chat', async () => {
        page = mount();
        await page.render(<Harness count={40} />);
        await until(() => search() !== null);

        await typeInto(search(), 'model 3');
        await until(() => rows().length === 10);
        expect(rows().every((row) => row.startsWith('Model 3'))).toBe(true);

        await typeInto(search(), 'deepseek');
        await until(() => rows().length === 10);
        const first = document.querySelector<HTMLElement>('[role="option"]')!;
        await clickOn(first);
        // DeepSeek holds every fourth model from the third, so its first by name is Model 02.
        expect(picked).toEqual(['vendor/model-02']);
    });

    test('a provider with eight models or fewer is listed whole, with no row to open', async () => {
        page = mount();
        await page.render(<Harness count={8} />);
        await until(() => rows().length === 8);
        expect(groupRow()).toBeNull();
    });
});
