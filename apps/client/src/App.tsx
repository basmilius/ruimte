import i18next from 'i18next';
import { useEffect, type ReactNode } from 'react';
import { desktop, machineMode } from '@/desktop/bridge';
import { useProjectSwitch } from '@/project/open';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { DormantScreen, ProjectSwitchScreen } from '@/shell/ProjectSwitchScreen';
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
import { ChatScopeProvider } from '@/transport/ChatScopeProvider';
import { ErrorBoundary, ShortcutHints, UIProvider, lazyDialog, lazyNamed, prefetcher, LazyBoundary } from '@adecore/ui';
import { formatSource } from '@/format/source';

const WorkspaceShell = lazyNamed(() => import('@/shell/WorkspaceShell'), 'WorkspaceShell');
const FirstRunScreen = lazyNamed(() => import('@/onboarding/FirstRunScreen'), 'FirstRunScreen');
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
const LoginDialog = lazyDialog(
    () => import('@/chat/LoginDialog'),
    'LoginDialog',
    useUi,
    (s) => s.login !== null
);
const ProviderCommandDialog = lazyDialog(
    () => import('@/chat/ProviderCommandDialog'),
    'ProviderCommandDialog',
    useUi,
    (s) => s.providerCommand !== null
);
const TemplateRequestDialog = lazyDialog(
    () => import('@/language/TemplateDialog'),
    'TemplateRequestDialog',
    useUi,
    (s) => s.templateRequest !== null
);
const OnboardingDialog = lazyDialog(
    () => import('@/onboarding/OnboardingDialog'),
    'OnboardingDialog',
    useUi,
    (s) => s.onboarding !== null
);
const AgentIntegrationsDialog = lazyDialog(
    () => import('@/shell/AgentIntegrationsDialog'),
    'AgentIntegrationsDialog',
    useUi,
    (s) => s.agentIntegrations
);
const ReleaseNotesDialog = lazyDialog(
    () => import('@/shell/ReleaseNotesDialog'),
    'ReleaseNotesDialog',
    useReleaseNotes,
    (s) => s.open
);

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

/* The approval a `/link` address opened, outside every workspace. The web client shows it before a machine is picked. */
function LinkRequestDialog() {
    const open = useLinkRequest((s) => s.open);
    const code = useLinkRequest((s) => s.code);
    return <LinkMachineDialog open={open} initialCode={code} onOpenChange={(next) => (next ? undefined : closeLinkRequest())} />;
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

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands. The shell reads it again from About.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload, useSettings.getState().updatesTrack) ?? undefined, []);

    // Every embedded page steps aside while a drag lasts, so it never swallows a drop meant for the cell under it.
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
        <UIProvider i18n={i18next} formatSource={formatSource}>
            <ChatScopeProvider>
                {/* The last resort, for a failure outside every view, node and panel. It unmounts the
                parked browser pages as well, which is why everything below carries a boundary of its own. */}
                <ErrorBoundary label={i18next.t('common:state.error')} className="fixed inset-0 bg-bg" reload>
                    <WindowContent />
                    <Floating surface="palette">
                        <CommandPalette />
                    </Floating>
                    <Floating surface="settings">
                        <SettingsDialog />
                    </Floating>
                    <UsageDialog />
                    <ModelsDialog />
                    <Floating surface="toasts">
                        <Toasts />
                    </Floating>
                    <ReleaseNotesDialog />
                    <Floating surface="machineUpdate">
                        <MachineUpdateDialog />
                    </Floating>
                    <Floating surface="link">
                        <LinkRequestDialog />
                    </Floating>
                    <Floating surface="onboarding">
                        <OnboardingDialog />
                    </Floating>
                    <Floating surface="agentIntegrations">
                        <AgentIntegrationsDialog />
                    </Floating>
                    <Floating surface="login">
                        <LoginDialog />
                    </Floating>
                    <Floating surface="providerCommand">
                        <ProviderCommandDialog />
                    </Floating>
                    <Floating surface="templateRequest">
                        <TemplateRequestDialog />
                    </Floating>
                    <Floating surface="shortcutHints">
                        <ShortcutHints />
                    </Floating>
                </ErrorBoundary>
            </ChatScopeProvider>
        </UIProvider>
    );
}
