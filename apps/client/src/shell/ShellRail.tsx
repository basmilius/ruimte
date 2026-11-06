import { UsageLimitsCard } from '@adecore/agents-react/usage';
import { IconButton, WorkspaceRail, WorkspaceRailSeparator, WorkspaceRailSpacer } from '@adecore/ui';
import { ArrowDownToLine, ChartNoAxesColumn, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hasOverlayControls } from '@/desktop/bridge';
import { LaunchChip } from '@/launches/LaunchChip';
import { useConnectionDotShown } from '@/machines/connection-dot';
import { ConnectionDot } from '@/machines/ConnectionDot';
import { PanelControls } from '@/shell/PanelControls';
import { useToolbarPanels } from '@/shell/panels';
import { isScratchProject, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { hasUpdate, useUpdates } from '@/state/updates';
import { APP_SHORTCUTS } from '@/surface/shortcuts';
import { useVoice } from '@/voice/state';
import { VoiceButton } from '@/voice/VoiceButton';

/* Below the window controls Linux draws over the top right, which stand as tall as the top row. */
const OVERLAY_INSET_PX = 47;

/*
 * The shell's tools, in one column at the window's right edge: the palette, the launches, the panels and
 * Routines, and at the foot the connection, Voice, Usage and Settings. A panel closes from its own button here.
 */
export function ShellRail() {
    const { t } = useTranslation('shell');
    const paletteOpen = useUi((s) => s.paletteOpen);
    // The Chats project has no folder to show, so no files, git, devices or launches either.
    const scratch = useProject((s) => isScratchProject(s.current));
    const hasPanelButtons = useToolbarPanels(scratch).length > 0;
    // These draw nothing while they have nothing to say, and their separator goes with them.
    const voice = useVoice((s) => s.credential?.configured === true);
    const update = hasUpdate(useUpdates());
    const connectionDot = useConnectionDotShown();

    return (
        <WorkspaceRail aria-label={t('rail.label')} style={hasOverlayControls() ? { paddingTop: OVERLAY_INSET_PX + 7 } : undefined}>
            <IconButton
                icon={Search}
                label={t('toolbar.search')}
                kbd={APP_SHORTCUTS.palette}
                tooltipSide="left"
                active={paletteOpen}
                onClick={() => useUi.getState().setPaletteOpen(true)}
            />
            {!scratch && (
                <>
                    <WorkspaceRailSeparator />
                    <LaunchChip />
                </>
            )}
            {hasPanelButtons && (
                <>
                    <WorkspaceRailSeparator />
                    <PanelControls />
                </>
            )}
            <WorkspaceRailSpacer />
            <UpdateButton />
            <ConnectionDot />
            <VoiceButton />
            {(voice || update || connectionDot) && <WorkspaceRailSeparator />}
            <UsageLimitsCard side="left">
                <IconButton icon={ChartNoAxesColumn} label={t('sidebar.usage')} tooltip={false} onClick={() => useUi.getState().setUsageOpen(true)} />
            </UsageLimitsCard>
            <IconButton
                icon={Settings}
                label={t('settingsDialog.title')}
                kbd={APP_SHORTCUTS.settings}
                tooltipSide="left"
                onClick={() => useUi.getState().setSettings({ open: true })}
            />
        </WorkspaceRail>
    );
}

/* Only there when there is something to do about a new version, and green because it is good news
   rather than a warning. It opens About, which says what the state is and acts on it. */
function UpdateButton() {
    const { t } = useTranslation('shell');
    const state = useUpdates();

    if (!hasUpdate(state)) {
        return null;
    }

    const label = state.status === 'ready' ? t('toolbar.updateReady', { version: state.version ?? '' }).trim() : t('toolbar.updateOnTheWay');

    return (
        <IconButton
            icon={ArrowDownToLine}
            label={label}
            tooltipSide="left"
            className="text-positive hover:text-positive"
            onClick={() => useUi.getState().setSettings({ open: true, section: 'about' })}
        />
    );
}
