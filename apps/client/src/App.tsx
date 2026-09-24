import i18next from 'i18next';
import { Suspense, useEffect } from 'react';
import { desktop } from '@/desktop/bridge';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { ProjectSwitchScreen } from '@/shell/ProjectSwitchScreen';
import { StartScreen } from '@/shell/StartScreen';
import { FLOATING_FAILURE, failed } from '@/shell/surface-failure';
import { MachineUpdateDialog } from '@/shell/MachineUpdateDialog';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { closeLinkRequest, useLinkRequest } from '@/pulsar/link-request';
import { useNativeMenu } from '@/shell/menu/native-menu';
import { Toasts } from '@/shell/Toasts';
import { watchDrags } from '@/shell/view-drag';
import { useProject } from '@/state/project';
import { useReleaseNotes } from '@/state/release-notes';
import { useSettings } from '@/state/settings';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { startUpdates } from '@/state/updates';
import { useWindow } from '@/state/window';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { lazyDialog, lazyNamed } from '@/ui/lazy';
import { prefetcher } from '@/ui/prefetch';
import { ShortcutHints } from '@/ui/ShortcutHints';
import { TooltipProvider } from '@/ui/Tooltip';

const loadWorkspaceShell = () => import('@/shell/WorkspaceShell');
const WorkspaceShell = lazyNamed(loadWorkspaceShell, 'WorkspaceShell');
const CommandPalette = lazyDialog(
    () => import('@/shell/CommandPalette'),
    'CommandPalette',
    useUi,
    (s) => s.paletteOpen
);
const SettingsDialog = lazyDialog(
    () => import('@/shell/SettingsDialog'),
    'SettingsDialog',
    useUi,
    (s) => s.settings.open
);
const UsageDialog = lazyDialog(
    () => import('@/shell/usage/UsageDialog'),
    'UsageDialog',
    useUi,
    (s) => s.usageOpen
);
const ModelsDialog = lazyDialog(
    () => import('@/shell/models/ModelsDialog'),
    'ModelsDialog',
    useUi,
    (s) => s.modelsOpen
);
const ReleaseNotesDialog = lazyDialog(
    () => import('@/shell/ReleaseNotesDialog'),
    'ReleaseNotesDialog',
    useReleaseNotes,
    (s) => s.open
);

/* The start screen, or the blank frame before it while a cold start is still trying the last project. */
function WindowContent() {
    const content = useWindow((s) => s.content);
    const booting = useWindow((s) => s.booting);
    const onStartScreen = content.kind !== 'workspace' && !booting;
    // The start screen is the first load, so the workspace follows only once that has painted.
    useEffect(() => {
        if (onStartScreen) {
            void prefetcher.prefetch(loadWorkspaceShell);
        }
    }, [onStartScreen]);
    if (content.kind === 'workspace') {
        return (
            <Suspense fallback={<div className="h-full w-full bg-bg" />}>
                <WorkspaceShell workspace={content.workspace} />
            </Suspense>
        );
    }
    return (
        <div className="relative h-full w-full bg-bg">
            {!booting && <StartScreen />}
            <ProjectSwitchScreen />
        </div>
    );
}

/* The approval a `/link` address opened, outside every workspace. The web client shows it before a machine is picked. */
function LinkRequestDialog() {
    const open = useLinkRequest((s) => s.open);
    const code = useLinkRequest((s) => s.code);
    return <LinkMachineDialog open={open} initialCode={code} onOpenChange={(next) => (next ? undefined : closeLinkRequest())} />;
}

export function App() {
    const name = useProject((s) => s.current?.name ?? null);
    useAppShortcuts();
    useNativeMenu();

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands. The shell reads it again from About.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload) ?? undefined, []);

    /* Every embedded page steps aside for as long as any drag lasts, so a drop target is wherever
       it looks like it is and never behind a page that swallowed the drag. */
    useEffect(() => watchDrags(), []);

    // The macOS application menu names a pane, and switches to it when the dialog is already open.
    useEffect(
        () =>
            desktop()?.onOpenSettings?.((section) => {
                const known = ALL_SETTINGS_SECTIONS.some((entry) => entry.id === section);
                useUi.getState().setSettings(known ? { open: true, section: section as SettingsSectionId } : { open: true });
            }),
        []
    );

    return (
        <TooltipProvider>
            {/* The last resort, for a failure outside every view, node and panel. It unmounts the
                parked browser pages as well, which is why everything below carries a boundary of its own. */}
            <ErrorBoundary label={i18next.t('common:state.error')} className="fixed inset-0 bg-bg" reload>
                <WindowContent />
                <ErrorBoundary label={failed('palette')} compact className={FLOATING_FAILURE}>
                    <CommandPalette />
                </ErrorBoundary>
                <ErrorBoundary label={failed('settings')} compact className={FLOATING_FAILURE}>
                    <SettingsDialog />
                </ErrorBoundary>
                <UsageDialog />
                <ModelsDialog />
                <ErrorBoundary label={failed('toasts')} compact className={FLOATING_FAILURE}>
                    <Toasts />
                </ErrorBoundary>
                <ReleaseNotesDialog />
                <ErrorBoundary label={failed('machineUpdate')} compact className={FLOATING_FAILURE}>
                    <MachineUpdateDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('link')} compact className={FLOATING_FAILURE}>
                    <LinkRequestDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('shortcutHints')} compact className={FLOATING_FAILURE}>
                    <ShortcutHints />
                </ErrorBoundary>
            </ErrorBoundary>
        </TooltipProvider>
    );
}
