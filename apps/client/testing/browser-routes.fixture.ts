import { browserRegistry, useBrowser } from '../src/browser/registry';
import { useEndpoints } from '../src/state/endpoints';
import { endpointKey } from '../src/state/keys';
import type { BrowserRouteBinding } from '@ruimte/desktop-bridge';
import { desktop } from '../src/desktop/bridge';

let next = 0;
const original = useEndpoints.getState();
function machine(daemonId: string, activeId = 'elsewhere'): void {
    useEndpoints.setState({ activeId, endpoints: original.endpoints.map((entry) => (entry.id === 'local' ? { ...entry, daemonId } : entry)) });
}
machine('fixture-owner');

const fixture = {
    create(endpoint: string, url: string, owner?: string, options?: { queuedUrl?: string; cancelOnReady?: boolean }) {
        const key = endpointKey(endpoint, 'fixture-' + ++next);
        const element = browserRegistry.ensure(key, url, owner);
        if (element) {
            if (options?.queuedUrl) {
                browserRegistry.navigate(key, options.queuedUrl);
            }
            if (options?.cancelOnReady) {
                element.addEventListener('dom-ready', () => browserRegistry.destroy(key), { once: true });
            }
            document.body.append(element);
        }
        return key;
    },
    state(key: string) {
        const element = browserRegistry.get(key);
        let id: number | undefined;
        try {
            id = element?.getWebContentsId();
        } catch {
            // The custom element can exist before Electron has attached its guest.
        }
        return { registered: !!element, row: useBrowser.getState().byKey[key], id };
    },
    run(key: string, code: string) {
        return browserRegistry.get(key)!.executeJavaScript(code);
    },
    rawLoad(key: string, url: string) {
        return browserRegistry
            .get(key)!
            .loadURL(url)
            .catch(() => undefined);
    },
    navigate(key: string, url: string) {
        browserRegistry.navigate(key, url);
    },
    back(key: string) {
        browserRegistry.back(key);
    },
    forward(key: string) {
        browserRegistry.forward(key);
    },
    destroy(key: string) {
        browserRegistry.destroy(key);
    },
    bind(value: BrowserRouteBinding) {
        return desktop()!.bindBrowserRoute!(value);
    },
    machine,
    rawGuest(partition: string, url: string) {
        const element = document.createElement('webview');
        element.setAttribute('partition', partition);
        element.setAttribute('src', url);
        element.setAttribute('nodeintegration', '');
        document.body.append(element);
    }
};
Object.assign(window, { routeTest: fixture });
export type RouteFixture = typeof fixture;
