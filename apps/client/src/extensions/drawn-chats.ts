import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { useInstalledExtensions } from '@/extensions/installed';
import { extensionsInSafeMode } from '@/extensions/safe-mode';

/*
 * Which extensions draw their own chats in this window. A chat whose extension is gone, off or held back by safe mode
 * is listed like any other, so a person still reaches what was said in it. Until the list came, each one still draws.
 */
export function chatDrawers(installed: readonly InstalledClientExtension[], listed: boolean, safeMode: boolean): (extensionId: string) => boolean {
    if (safeMode) {
        return () => false;
    }

    if (!listed) {
        return () => true;
    }

    const running = new Set(installed.filter((entry) => entry.enabled).map((entry) => entry.manifest.id));

    return (extensionId) => running.has(extensionId);
}

export function useChatDrawers(): (extensionId: string) => boolean {
    const installed = useInstalledExtensions((state) => state.installed);
    const listed = useInstalledExtensions((state) => state.listed === true);

    return chatDrawers(installed, listed, extensionsInSafeMode());
}
