import { type UsageDesktopCounter, type UsageDesktopPanel, type UsageDesktopSettingsSection, USAGE_DESKTOP_SETTINGS_SECTIONS } from '@ruimte/pulsar';
import { countDesktopUsage } from '@/commands/usage';
import { desktop } from '@/desktop/bridge';
import { useUi, type SettingsSectionId } from '@/state/ui';

/* The counter a settings section opens. A section newer than Observatory's list is counted nowhere until the list there has it. */
export function usageSectionOf(section: SettingsSectionId): UsageDesktopSettingsSection | null {
    return (USAGE_DESKTOP_SETTINGS_SECTIONS as readonly string[]).includes(section) ? (section as UsageDesktopSettingsSection) : null;
}

type Watched = Pick<ReturnType<typeof useUi.getState>, 'panel' | 'panelsRestoring' | 'settings'>;

/* What one change of the UI state opened: a panel a person brought up, never one a project put back, and the settings and the section they show. */
export function openedBy(state: Watched, previous: Watched): UsageDesktopCounter[] {
    const opened: UsageDesktopCounter[] = [];
    const { panel } = state;
    // Which extensions a person opens stays on this computer.
    if (panel.open && !panel.kind.startsWith('extension:') && !state.panelsRestoring && (!previous.panel.open || previous.panel.kind !== panel.kind)) {
        opened.push(`panels.${panel.kind as UsageDesktopPanel}`);
    }
    const section = usageSectionOf(state.settings.section);
    if (state.settings.open && !previous.settings.open) {
        opened.push('dialogs.settings');
    }

    if (section !== null && state.settings.open && (!previous.settings.open || previous.settings.section !== state.settings.section)) {
        opened.push(`settingsSections.${section}`);
    }

    return opened;
}

/* Once per page, and only in a shell that takes counts. */
export function watchDesktopUsage(): () => void {
    if (desktop()?.countUsage === undefined) {
        return () => undefined;
    }
    return useUi.subscribe((state, previous) => {
        for (const name of openedBy(state, previous)) {
            countDesktopUsage(name);
        }
    });
}
