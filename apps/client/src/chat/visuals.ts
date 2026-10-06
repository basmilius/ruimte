import type { VisualHost } from '@adecore/agents-react/host';
import { VISUAL_HOST_PATH } from '@ruimte/csp';
import type { DesktopBridge } from '@/desktop/bridge';

/*
 * Where a thread draws the pages agents publish: the sandbox host page on the page's own origin, which
 * every server of the client answers under that page's policy. A link a person follows in one opens
 * in the system browser on the desktop, and in a tab of its own anywhere else.
 */
export function visualHostFor(origin: string, bridge: () => Pick<DesktopBridge, 'openExternal'> | null, openTab: (url: string) => void): VisualHost {
    return {
        frameUrl: new URL(VISUAL_HOST_PATH, origin).href,
        openLink: (url) => {
            // An agent's page asked for it, and anything but the web (a `javascript:` URL) would run on the app's origin.
            if (!/^https?:\/\//i.test(url)) {
                return;
            }
            const desktop = bridge();
            if (desktop) {
                void desktop.openExternal(url);
            } else {
                openTab(url);
            }
        }
    };
}
