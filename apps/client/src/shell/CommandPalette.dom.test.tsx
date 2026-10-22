import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';

let page: Mounted;

function field(): HTMLInputElement | null {
    return document.querySelector('input[role="combobox"]');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function highlighted(): HTMLElement | undefined {
    return rows().find((row) => row.getAttribute('aria-selected') === 'true');
}

function expectFieldHoldsTheKeys(row: HTMLElement): void {
    expect(document.activeElement).toBe(field());
    expect(field()!.getAttribute('aria-activedescendant')).toBe(row.id);
    expect(highlighted()).toBe(row);
}

async function type(text: string): Promise<void> {
    await act(async () => {
        const input = field()!;
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

beforeEach(async () => {
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPaletteOpen(true));
    await until(() => field() !== null && document.activeElement === field() && rows().length > 2);
});

afterEach(async () => {
    await act(async () => useUi.getState().setPaletteOpen(false));
    await page.unmount();
});

describe('the command palette keeps the keyboard in its field', () => {
    test('the rows stay out of the tab order', () => {
        expect(rows().every((row) => row.tabIndex === -1)).toBe(true);
    });

    test('the arrow keys move the highlight and the field keeps the focus', async () => {
        expectFieldHoldsTheKeys(rows()[0]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[1]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[2]!);
        await pressKey(field()!, 'ArrowUp');
        expectFieldHoldsTheKeys(rows()[1]!);
    });

    test('hovering a row highlights it and the field keeps the focus', async () => {
        const row = rows()[2]!;
        await act(async () => {
            row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
        });
        expectFieldHoldsTheKeys(row);
    });

    test('pressing a row does not take the focus out of the field', async () => {
        const pressed = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        await act(async () => {
            rows()[1]!.dispatchEvent(pressed);
        });
        expect(pressed.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(field());
    });

    test('a row that gets the focus anyway hands it back to the field', async () => {
        await pressKey(field()!, 'ArrowDown');
        const row = highlighted()!;
        await act(async () => row.focus());
        expectFieldHoldsTheKeys(row);
    });

    test('what is typed lands in the field and filters the list', async () => {
        const before = rows().length;
        await pressKey(field()!, 'ArrowDown');
        await type('open folder');
        await until(() => rows().length < before);
        expect(field()!.value).toBe('open folder');
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().every((row) => row.textContent!.toLowerCase().includes('open folder'))).toBe(true);
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});
