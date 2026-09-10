import { Dialog } from '@base-ui-components/react/dialog';
import { Tabs } from '@base-ui-components/react/tabs';
import { faXmark } from '@fortawesome/duotone-regular-svg-icons';
import { SettingsNav } from '@/shell/settings/SettingsNav';
import { AboutPane } from '@/shell/settings/panes/AboutPane';
import { AgentsPane } from '@/shell/settings/panes/AgentsPane';
import { AppearancePane } from '@/shell/settings/panes/AppearancePane';
import { CanvasPane } from '@/shell/settings/panes/CanvasPane';
import { KeyboardPane } from '@/shell/settings/panes/KeyboardPane';
import { MachinesPane } from '@/shell/settings/panes/MachinesPane';
import { SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { Icon } from '@/ui/Icon';

const PANES: Record<SettingsSectionId, () => React.JSX.Element> = {
    appearance: AppearancePane,
    canvas: CanvasPane,
    agents: AgentsPane,
    machines: MachinesPane,
    keyboard: KeyboardPane,
    about: AboutPane
};

/* Sections on the left, one pane on the right. Opens on the section the caller asked for, or the last one. */
export function SettingsDialog() {
    const open = useUi((s) => s.settings.open);
    const section = useUi((s) => s.settings.section);
    const setSettings = useUi((s) => s.setSettings);
    const meta = SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]!;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => setSettings({ open: next })}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[10vh] flex h-[min(600px,80vh)] w-[820px]">
                    <Tabs.Root
                        value={section}
                        onValueChange={(value) => setSettings({ section: value as SettingsSectionId })}
                        orientation="vertical"
                        className="flex min-h-0 grow"
                    >
                        <div className="flex w-48 shrink-0 flex-col gap-3 border-r border-border bg-surface p-3">
                            <Dialog.Title className="px-2.5 pt-1 text-base font-semibold text-text">Settings</Dialog.Title>
                            <SettingsNav />
                        </div>
                        {SETTINGS_SECTIONS.map((entry) => {
                            const Pane = PANES[entry.id];
                            return (
                                <Tabs.Panel key={entry.id} value={entry.id} keepMounted={false} className="flex min-h-0 min-w-0 grow flex-col outline-none">
                                    <div className="flex items-start gap-4 px-6 pt-5 pb-4">
                                        <div className="min-w-0 grow">
                                            <h2 className="text-base font-semibold text-text">{entry.label}</h2>
                                            <p className="mt-0.5 text-xs text-text-muted">{entry.description}</p>
                                        </div>
                                        <Dialog.Close className="icon-btn h-7 w-7" aria-label="Close">
                                            <Icon icon={faXmark} size={16} />
                                        </Dialog.Close>
                                    </div>
                                    <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6 pb-6">
                                        <Pane />
                                    </div>
                                </Tabs.Panel>
                            );
                        })}
                    </Tabs.Root>
                    <Dialog.Description className="sr-only">{meta.description}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
