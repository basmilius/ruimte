import { ignoreRefusal, perform } from '@/action-port/perform';

const HISTORY_ACTIONS = { back: 'browser.back', forward: 'browser.forward', stop: 'browser.stop' } as const;

/*
 * Where a browser node goes next. A node without an address gets one here, which is what starts its
 * page, so a node that begins empty ends up the same as one made with an address.
 */
export function openPage(id: string, input: string): void {
    void perform('browser.navigate', { nodeId: id, url: input }).catch(ignoreRefusal);
}

/* The page's own buttons and menu: its history, a reload and a stop, never a click inside it. */
export function drivePage(id: string, action: 'back' | 'forward' | 'reload' | 'stop', hard = false): void {
    if (action === 'reload') {
        void perform('browser.reload', { nodeId: id, hard }).catch(ignoreRefusal);
        return;
    }
    void perform(HISTORY_ACTIONS[action], { nodeId: id }).catch(ignoreRefusal);
}
