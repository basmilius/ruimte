import { ErrorBoundary, ShortcutHints, UIProvider, lazyNamed, prefetcher, LazyBoundary } from '@adecore/ui';
import i18next from 'i18next';
import { useEffect, type ReactNode } from 'react';
import { startMachineUpdate } from '@/controllers/machine-update';
import { desktop, machineMode } from '@/desktop/bridge';
import { HostDialogs, HostOverlays } from '@/extensions/host/host-dialogs';
import '@/extensions/built-in';
import { startExtensions } from '@/extensions/watch';
import { formatSource } from '@/format/source';
import { useProjectSwitch } from '@/project/open';
import { DormantScreen, ProjectSwitchScreen } from '@/project/ProjectSwitchScreen';
import { windowDialogs } from '@/registry/dialogs';
import { allSettingsSections } from '@/settings/sections';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { useNativeMenu } from '@/shell/menu/native-menu';
import { StartScreen } from '@/shell/StartScreen';
import { Toasts } from '@/shell/Toasts';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { startUpdates } from '@/state/updates';
import { FLOATING_FAILURE, failed } from '@/surface/surface-failure';
import { watchDrags } from '@/surface/view-drag';
import { ChatScopeProvider } from '@/workspace/ChatScopeProvider';
import { useWindow } from '@/workspace/window';

const WorkspaceShell = lazyNamed(async () => {
    const { installWorkspace } = await import('@/wiring/workspace');
    installWorkspace();

    return import('@/shell/WorkspaceShell');
}, 'WorkspaceShell');
const FirstRunScreen = lazyNamed(() => import('@/onboarding/FirstRunScreen'), 'FirstRunScreen');
const BLANK = <div className="h-full w-full bg-bg" />;

/* The start screen, or the blank frame before it while a cold start is still trying the last project. */
function WindowContent() {
    const content = useWindow((s) => s.content);
    const booting = useWindow((s) => s.booting);
    const opening = useProjectSwitch((state) => state.kind === 'connecting' || state.kind === 'opening');
    const onStartScreen = content.kind !== 'workspace' && !booting && machineMode() !== 'ask';
    // A requested workspace loads beside its connection; an idle start screen only prefetches it.
    useEffect(() => {
        if (opening) {
            void WorkspaceShell.preload().catch(() => undefined);
        } else if (onStartScreen) {
            void prefetcher.prefetch(WorkspaceShell.preload);
        }
    }, [onStartScreen, opening]);
    // A new install asks before anything runs, and only that install ever loads the screen.
    if (machineMode() === 'ask') {
        return (
            <ErrorBoundary label={failed('firstRun')}>
                <LazyBoundary fallback={BLANK}>
                    <FirstRunScreen />
                </LazyBoundary>
            </ErrorBoundary>
        );
    }
    if (content.kind === 'workspace') {
        return (
            <LazyBoundary fallback={BLANK}>
                <WorkspaceShell workspace={content.workspace} />
            </LazyBoundary>
        );
    }
    return (
        <div className="relative h-full w-full bg-bg">
            {!booting && <StartScreen />}
            <DormantScreen />
            <ProjectSwitchScreen />
        </div>
    );
}

/* A surface that floats over the window, so its failure is a card and the rest stays usable. */
function Floating({ surface, children }: { surface: string; children: ReactNode }) {
    return (
        <ErrorBoundary label={failed(surface)} compact className={FLOATING_FAILURE}>
            {children}
        </ErrorBoundary>
    );
}

export function App() {
    const name = useProject((s) => s.current?.name ?? null);
    useAppShortcuts();
    useNativeMenu();
    const dialogs = windowDialogs.useAll();

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands. The shell reads it again from About.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload, useSettings.getState().updatesTrack, startMachineUpdate) ?? undefined, []);

    // Every embedded page steps aside while a drag lasts, so it never swallows a drop meant for the cell under it.
    useEffect(() => watchDrags(), []);
    useEffect(() => startExtensions(), []);

    // The macOS application menu names a pane, and switches to it when the dialog is already open.
    useEffect(
        () =>
            desktop()?.onOpenSettings?.((section) => {
                const known = allSettingsSections().some((entry) => entry.id === section);
                useUi.getState().setSettings(known ? { open: true, section: section as SettingsSectionId } : { open: true });
            }),
        []
    );

    return (
        <UIProvider i18n={i18next} formatSource={formatSource}>
            <ChatScopeProvider>
                {/* The last resort, for a failure outside every view, node and panel. It unmounts the
                parked browser pages as well, which is why everything below carries a boundary of its own. */}
                <ErrorBoundary label={i18next.t('common:state.error')} className="fixed inset-0 bg-bg" reload>
                    <WindowContent />
                    <Floating surface="toasts">
                        <Toasts />
                        <HostDialogs />
                        <HostOverlays />
                    </Floating>
                    {dialogs.map((dialog) =>
                        dialog.surface === null ? (
                            <dialog.component key={dialog.id} />
                        ) : (
                            <Floating key={dialog.id} surface={dialog.surface}>
                                <dialog.component />
                            </Floating>
                        )
                    )}
                    <Floating surface="shortcutHints">
                        <ShortcutHints />
                    </Floating>
                </ErrorBoundary>
            </ChatScopeProvider>
        </UIProvider>
    );
}
