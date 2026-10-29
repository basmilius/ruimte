import { expect } from 'bun:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { ChatHostProvider } from '@adecore/agents-react';
import { UIProvider } from '@adecore/ui';
import { App } from '@/App';
import { CHAT_HOST, configureChat } from '@/chat/host';
import { startFileReadPreparation } from '@/project/file-read-preparation';
import { defaultProjectStore } from '@/state/project';
import { defaultDocumentStore } from '@/state/document';
import { folderWatches } from '@/state/fs-watch';
import { useFiles } from '@/state/files';
import { ChatScopeProvider } from '@/transport/ChatScopeProvider';

// Once for the process, before any chat store is read, as `main.tsx` does it.
configureChat();
startFileReadPreparation(defaultProjectStore, defaultDocumentStore, folderWatches, useFiles);

/*
 * Lets what a fake machine answered and what React drew from it land. Bounded by turns of the event
 * loop rather than by a clock, so a slow machine waits longer and a missing answer still fails.
 */
export async function until(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !condition(); turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
    expect(condition()).toBe(true);
}

export interface Mounted {
    host: HTMLElement;
    /* `element` with the providers the app puts around everything. */
    render(element: ReactNode): Promise<void>;
    /* The whole window, the way `main.tsx` draws it, with `beside` next to it. */
    renderApp(beside?: ReactNode): Promise<void>;
    unmount(): Promise<void>;
}

/* A root of its own in the page. */
export function mount(): Mounted {
    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    return {
        host,
        render: async (element) => {
            await act(async () => {
                root.render(
                    <UIProvider i18n={i18next}>
                        <ChatHostProvider host={CHAT_HOST}>
                            <ChatScopeProvider>{element}</ChatScopeProvider>
                        </ChatHostProvider>
                    </UIProvider>
                );
            });
        },
        renderApp: async (beside) => {
            await act(async () => {
                root.render(
                    <ChatHostProvider host={CHAT_HOST}>
                        <App />
                        {beside !== undefined && <UIProvider i18n={i18next}>{beside}</UIProvider>}
                    </ChatHostProvider>
                );
            });
        },
        unmount: async () => {
            await act(async () => root.unmount());
            host.remove();
        }
    };
}

/* The physical key a US layout puts a letter or a digit on, which is what a shortcut matches. */
function codeOf(key: string): string {
    if (/^[a-z]$/i.test(key)) {
        return `Key${key.toUpperCase()}`;
    }
    return /^[0-9]$/.test(key) ? `Digit${key}` : key;
}

/* What a browser sends for a key, at the element that has the keyboard. */
export async function pressKey(
    target: Element,
    key: string,
    modifiers: Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}
): Promise<void> {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code: codeOf(key), bubbles: true, cancelable: true, ...modifiers }));
    });
}

export async function clickOn(element: Element | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
        (element as HTMLElement).click();
    });
}

function foldedToolGroups(host: Element): HTMLElement[] {
    return ([...host.querySelectorAll('button[aria-expanded="false"]')] as HTMLElement[]).filter(
        (button) => button.classList.contains('group/line') && button.closest('[data-find-item]') === null
    );
}

/* Unfolds the tool groups of a thread until the row of `itemId` is drawn; a thread folds even a single call. */
export async function openToolCall(host: Element, itemId: string): Promise<void> {
    const row = (): Element | null => host.querySelector(`[data-find-item="${itemId}"]`);
    await until(() => row() !== null || foldedToolGroups(host).length > 0);
    for (const button of foldedToolGroups(host)) {
        await clickOn(button);
    }
    await until(() => row() !== null);
}

/* Opens the submenu behind the row that says `label` in a menu that is open, the way a click on its trigger does. */
export async function openSubmenu(label: string): Promise<void> {
    const before = document.querySelectorAll('[role="menu"]').length;
    const trigger = ([...document.querySelectorAll('[role="menuitem"][aria-haspopup]')] as HTMLElement[]).find((item) => item.textContent?.includes(label)) ?? null;
    await clickOn(trigger);
    await until(() => document.querySelectorAll('[role="menu"]').length > before);
}

/*
 * Gives the elements `height` names the height happy-dom never lays out, and returns what puts it back.
 * A virtualized thread reads its viewport from `clientHeight` and its rows from `offsetHeight`, so both answer.
 */
export function layOut(height: (element: HTMLElement) => number | null): () => void {
    const restores = (['offsetHeight', 'clientHeight'] as const).map((property) => {
        const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
        const inherited = own ?? Object.getOwnPropertyDescriptor(Element.prototype, property);
        Object.defineProperty(HTMLElement.prototype, property, {
            configurable: true,
            get(this: HTMLElement) {
                return height(this) ?? inherited?.get?.call(this) ?? 0;
            }
        });
        return () => {
            if (own === undefined) {
                delete (HTMLElement.prototype as Partial<Record<typeof property, number>>)[property];
            } else {
                Object.defineProperty(HTMLElement.prototype, property, own);
            }
        };
    });
    return () => {
        for (const restore of restores) {
            restore();
        }
    };
}

/* A chat's scroller 800 high; without a height of its own the virtualized thread shows no row at all. */
export function layOutChat(): () => void {
    return layOut((element) => (element.classList.contains('chat-scroll') ? 800 : null));
}
