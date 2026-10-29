import {
    USAGE_DESKTOP_COMMANDS,
    type UsageCommandSource,
    type UsageDesktopCommand,
    type UsageDesktopCounter,
    type UsageDesktopPanel,
    type UsageDesktopSettingsSection
} from '@ruimte/pulsar';
import { desktop } from '@/desktop/bridge';
import { isCommandId } from '@/shell/command-table';
import { useUi, type SettingsSectionId } from '@/state/ui';

/*
 * What the desktop app counts for its own usage report that no machine sees: the commands a person
 * gives and where from, and the panels and settings they open. The shell keeps the counts, drops a name
 * it does not know and counts nothing while the machine's switch is off; outside it nothing is sent.
 */

// The rows made once per view, launch, agent or layout, each counted under one name and never by its own id.
const GENERATED_ROWS: readonly (readonly [prefix: string, name: UsageDesktopCommand])[] = [
    ['agent-view-chat-', 'agentViewChat'],
    ['agent-view-terminal-', 'agentViewTerminal'],
    ['agent-chat-', 'agentChat'],
    ['agent-terminal-', 'agentTerminal'],
    ['view-move-', 'viewMove'],
    ['go-view-', 'goView'],
    ['chat-move-project-', 'chatMoveProject'],
    ['launch-start-', 'launchStart'],
    ['launch-restart-', 'launchRestart'],
    ['launch-stop-', 'launchStopListed'],
    ['launch-choose-', 'launchChoose'],
    ['launch-after-settle-', 'launchAfterSettle'],
    ['layout-apply-', 'layoutApply'],
    ['layout-delete-', 'layoutDelete'],
    ['pr-show-in-', 'prShowIn']
];

const COMMAND_NAMES: ReadonlySet<string> = new Set(USAGE_DESKTOP_COMMANDS);

/* The counted name of a command row, or null for an id that is no row of the table or of a generated kind. */
export function commandUsageName(id: string): UsageDesktopCommand | null {
    if (isCommandId(id)) {
        const name = id.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
        return COMMAND_NAMES.has(name) ? (name as UsageDesktopCommand) : null;
    }
    return GENERATED_ROWS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}

export function countDesktopUsage(name: UsageDesktopCounter): void {
    desktop()?.countUsage?.(name);
}

export function countCommand(id: string, source: UsageCommandSource): void {
    const name = commandUsageName(id);
    if (name !== null) {
        countDesktopUsage(`commands.${source}.${name}`);
    }
}

/* The counter a settings section opens; Pets is counted nowhere. */
export function usageSectionOf(section: SettingsSectionId): UsageDesktopSettingsSection | null {
    return section === 'pets' ? null : section;
}

type Watched = Pick<ReturnType<typeof useUi.getState>, 'panel' | 'panelsRestoring' | 'settings'>;

/* What one change of the UI state opened: a panel a person brought up, never one a project put back, and the settings and the section they show. */
export function openedBy(state: Watched, previous: Watched): UsageDesktopCounter[] {
    const opened: UsageDesktopCounter[] = [];
    const { panel } = state;
    if (panel.open && !state.panelsRestoring && (!previous.panel.open || previous.panel.kind !== panel.kind)) {
        opened.push(`panels.${panel.kind satisfies UsageDesktopPanel}`);
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
