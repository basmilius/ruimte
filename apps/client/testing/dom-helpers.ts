import { act } from 'react';
import type { DesktopBridge } from '@/desktop/bridge';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

/* A desktop shell whose members do nothing, with `patch` on top; a member patched to undefined is left out. */
export function installDesktop(patch: Partial<DesktopBridge> = {}): void {
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    } as DesktopBridge;
}

export function removeDesktop(): void {
    delete scope.window.ruimteDesktop;
}

export function everything(): string {
    return document.body.textContent ?? '';
}

export function buttonWithText(label: string, within: ParentNode = document): HTMLButtonElement | null {
    return [...within.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label) ?? null;
}

export function menuItem(text: string, role = 'menuitem'): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((item) => item.textContent?.includes(text)) ?? null;
}

/* Types into a controlled input the way a browser does, which React only notices through the native setter. */
export async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
