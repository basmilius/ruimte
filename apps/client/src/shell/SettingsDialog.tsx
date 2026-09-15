import { Dialog } from '@base-ui-components/react/dialog';
import { Tabs } from '@base-ui-components/react/tabs';
import { X } from 'lucide-react';
import { SettingsNav } from '@/shell/settings/SettingsNav';
import { AboutPane } from '@/shell/settings/panes/AboutPane';
import { AgentsPane } from '@/shell/settings/panes/AgentsPane';
import { AppearancePane } from '@/shell/settings/panes/AppearancePane';
import { FilesPane } from '@/shell/settings/panes/FilesPane';
import { KeyboardPane } from '@/shell/settings/panes/KeyboardPane';
import { MachinesPane } from '@/shell/settings/panes/MachinesPane';
import { UsagePane } from '@/shell/settings/panes/UsagePane';
import { ViewsPane } from '@/shell/settings/panes/ViewsPane';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';

const SECTION_ITEMS = ALL_SETTINGS_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }));

const PANES: Record<SettingsSectionId, () => React.JSX.Element> = {
    appearance: AppearancePane,
    views: ViewsPane,
    files: FilesPane,
    usage: UsagePane,
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
    const meta = ALL_SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? ALL_SETTINGS_SECTIONS[0]!;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => setSettings({ open: next })}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                {/* The width steps down with the viewport: a narrower navigation on a tablet, and a menu of
                    sections instead of the column where even that leaves the panes too little room. */}
                <Dialog.Popup className="dialog-popup touch-roomy flex h-[min(640px,calc(100dvh-32px))] w-[820px]">
                    <Tabs.Root
                        value={section}
                        onValueChange={(value) => setSettings({ section: value as SettingsSectionId })}
                        orientation="vertical"
                        className="flex min-h-0 min-w-0 grow max-[640px]:flex-col"
                    >
                        <div className="flex w-48 shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 max-[960px]:w-40 max-[640px]:w-auto max-[640px]:flex-row max-[640px]:items-center max-[640px]:border-r-0 max-[640px]:border-b">
                            <Dialog.Title className="px-2.5 pt-2 text-base font-semibold text-text max-[640px]:pt-0">Settings</Dialog.Title>
                            <div className="min-w-0 max-[640px]:hidden">
                                <SettingsNav />
                            </div>
                            <div className="min-w-0 grow min-[641px]:hidden">
                                <Select
                                    value={section}
                                    items={SECTION_ITEMS}
                                    onValueChange={(value) => setSettings({ section: value })}
                                    label="Settings section"
                                />
                            </div>
                        </div>
                        {/* The header sits outside the panels: inside one it remounts on every section
                            change, which throws the keyboard's focus away mid-arrow-key. */}
                        <div className="flex min-h-0 min-w-0 grow flex-col">
                            <div className="flex min-w-0 items-start gap-4 px-6 pt-5 pb-4 max-[960px]:px-4">
                                <div className="min-w-0 grow">
                                    <h2 className="text-base font-semibold text-text">{meta.label}</h2>
                                    <p className="mt-0.5 text-xs break-words text-text-muted">{meta.description}</p>
                                </div>
                                <Dialog.Close className="icon-btn h-7 w-7 shrink-0" aria-label="Close settings">
                                    <Icon icon={X} size={16} />
                                </Dialog.Close>
                            </div>
                            {ALL_SETTINGS_SECTIONS.map((entry) => {
                                const Pane = PANES[entry.id];
                                return (
                                    <Tabs.Panel
                                        key={entry.id}
                                        value={entry.id}
                                        keepMounted={false}
                                        className="flex min-h-0 min-w-0 grow flex-col gap-5 overflow-y-auto px-6 pb-6 outline-none max-[960px]:px-4"
                                    >
                                        <Pane />
                                    </Tabs.Panel>
                                );
                            })}
                        </div>
                    </Tabs.Root>
                    <Dialog.Description className="sr-only">{meta.description}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
