import { CHAT_PREFERENCES_KEY, reloadChatPreferences } from '@adecore/agents-react/chat';
import { reloadUsagePreferences, USAGE_PREFERENCES_KEY } from '@adecore/agents-react/state';
import { useContributions } from '@/extensions/registry';
import { applyStoredExtensionTheme, EXTENSION_THEME_STORAGE_KEY } from '@/extensions/themes';
import { followLanguageAndRegion } from '@/i18n';
import { reloadOverrides, SHORTCUT_OVERRIDES_KEY } from '@/shell/shortcut-overrides';
import { ENDPOINTS_STORAGE_KEY, useEndpoints } from '@/state/endpoints';
import { followOtherWindows, type StorageTarget } from '@/state/other-windows';
import { SETTINGS_STORAGE_KEY, useSettings } from '@/state/settings';
import { THEME_STORAGE_KEY, useTheme } from '@/state/theme';

/* A language or a region picked in another window redraws this one too; reading the setting alone would not. */
function reloadSettings(): void {
    const before = useSettings.getState();
    useSettings.getState().reload();
    const after = useSettings.getState();

    if (before.language !== after.language || before.formatRegion !== after.formatRegion) {
        void followLanguageAndRegion();
    }
}

/*
 * The keys a person means for the whole app: the machines this client knows (with the keys it
 * pinned for them), the settings, the theme, the keys they rebound, the defaults a new agent starts with, how the usage
 * page reads and what a built-in names. What a window keeps for itself (the open view, the camera,
 * the panels) stays out of it.
 */
export function startSharedStorage(target?: StorageTarget | null): () => void {
    const stops = [
        followOtherWindows(ENDPOINTS_STORAGE_KEY, () => useEndpoints.getState().reload(), target),
        followOtherWindows(SETTINGS_STORAGE_KEY, reloadSettings, target),
        followOtherWindows(THEME_STORAGE_KEY, () => useTheme.getState().reload(), target),
        followOtherWindows(SHORTCUT_OVERRIDES_KEY, reloadOverrides, target),
        followOtherWindows(EXTENSION_THEME_STORAGE_KEY, applyStoredExtensionTheme, target),
        followOtherWindows(CHAT_PREFERENCES_KEY, reloadChatPreferences, target),
        followOtherWindows(USAGE_PREFERENCES_KEY, reloadUsagePreferences, target),
        ...useContributions.getState().sharedStorage.map((storage) => followOtherWindows(storage.id, storage.reload, target))
    ];
    return () => stops.forEach((stop) => stop());
}
