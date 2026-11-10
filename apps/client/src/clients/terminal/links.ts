import { isLoopbackBrowserUrl } from '@ruimte/contracts';
import { desktop, type DesktopBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';

export function isTerminalLinkClick(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, apple: boolean): boolean {
    return event.button === 0 && !event.altKey && !event.shiftKey && (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

export function terminalLinkTarget(uri: string, endpointId: string, localDesktop: boolean): 'web' | 'remote-loopback' | 'invalid' {
    // Keep the addon's complete target; URL parsing is validation, never a reconstruction from screen rows.
    if (!/^https?:\/\//i.test(uri) || Array.from(uri).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
        return 'invalid';
    }
    const url = URL.parse(uri);
    if (!url || !['http:', 'https:'].includes(url.protocol)) {
        return 'invalid';
    }
    return isLoopbackBrowserUrl(uri) && !(localDesktop && endpointId === LOCAL_ENDPOINT_ID) ? 'remote-loopback' : 'web';
}

export function openTerminalLink(
    uri: string,
    endpointId: string,
    {
        unavailable,
        openInRuimte,
        bridge = desktop(),
        openTab = (url) => {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }: {
        unavailable: () => void;
        openInRuimte?: (uri: string) => boolean;
        bridge?: Pick<DesktopBridge, 'openExternal'> | null;
        openTab?: (uri: string) => void;
    }
): void {
    const target = terminalLinkTarget(uri, endpointId, bridge !== null);
    if (target === 'remote-loopback') {
        unavailable();
    } else if (target === 'web' && !openInRuimte?.(uri)) {
        if (bridge) {
            void bridge.openExternal(uri);
        } else {
            openTab(uri);
        }
    }
}
