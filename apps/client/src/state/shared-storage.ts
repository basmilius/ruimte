import { CHAT_PREFERENCES_KEY, reloadChatPreferences } from '@adecore/agents-react/chat/preferences';
import { reloadUsagePreferences, USAGE_PREFERENCES_KEY } from '@adecore/agents-react/state/usage';
import { ENDPOINTS_STORAGE_KEY, useEndpoints } from '@/state/endpoints';
import { followOtherWindows, type StorageTarget } from '@/state/other-windows';
import { SETTINGS_STORAGE_KEY, useSettings } from '@/state/settings';
import { THEME_STORAGE_KEY, useTheme } from '@/state/theme';

/*
 * The keys a person means for the whole app: the machines this client knows (with the keys it
 * pinned for them), the settings, the theme, the defaults a new agent starts with and how the usage
 * page reads. What a window keeps for itself (the open view, the camera, the panels) stays out of it.
 */
export function startSharedStorage(target?: StorageTarget | null): () => void {
    const stops = [
        followOtherWindows(ENDPOINTS_STORAGE_KEY, () => useEndpoints.getState().reload(), target),
        followOtherWindows(SETTINGS_STORAGE_KEY, () => useSettings.getState().reload(), target),
        followOtherWindows(THEME_STORAGE_KEY, () => useTheme.getState().reload(), target),
        followOtherWindows(CHAT_PREFERENCES_KEY, reloadChatPreferences, target),
        followOtherWindows(USAGE_PREFERENCES_KEY, reloadUsagePreferences, target)
    ];
    return () => stops.forEach((stop) => stop());
}
