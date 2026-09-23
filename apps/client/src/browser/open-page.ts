import { runAsPerson } from '@/actions/client-actions';

/*
 * Where a browser node goes next. A node without an address is given one, which is what starts its
 * page at all: the splash and the address bar both come through here, so a node that begins empty
 * ends up the same as one that was made with an address.
 */
export const openPage = (id: string, input: string): void => {
    void runAsPerson('browser.navigate', { nodeId: id, url: input });
};

/* The page's own buttons and menu: its history, a reload and a stop, never a click inside it. */
export const drivePage = (id: string, action: 'back' | 'forward' | 'reload' | 'stop', hard = false): void => {
    if (action === 'reload') {
        void runAsPerson('browser.reload', { nodeId: id, hard });
        return;
    }
    void runAsPerson(action === 'back' ? 'browser.back' : action === 'forward' ? 'browser.forward' : 'browser.stop', { nodeId: id });
};
