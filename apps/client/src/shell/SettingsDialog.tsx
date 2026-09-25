import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { Tabs } from '@base-ui-components/react/tabs';
import { SettingsNav, SettingsSearch, SettingsSearchResults } from '@/shell/settings/SettingsNav';
import { AboutPane } from '@/shell/settings/panes/AboutPane';
import { AgentsPane } from '@/shell/settings/panes/AgentsPane';
import { AppearancePane } from '@/shell/settings/panes/AppearancePane';
import { ComputerPane } from '@/shell/settings/panes/ComputerPane';
import { FilesPane } from '@/shell/settings/panes/FilesPane';
import { KeyboardPane } from '@/shell/settings/panes/KeyboardPane';
import { MachinesPane } from '@/shell/settings/panes/MachinesPane';
import { ProvidersPane } from '@/shell/settings/panes/ProvidersPane';
import { UsagePane } from '@/shell/settings/panes/UsagePane';
import { ViewsPane } from '@/shell/settings/panes/ViewsPane';
import { VoicePane } from '@/shell/settings/panes/VoicePane';
import type { SearchResult } from '@/shell/settings/search';
import { ALL_SETTINGS_SECTIONS, sectionDescription, sectionLabel } from '@/shell/settings/sections';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { CloseButton } from '@/ui/CloseButton';
import { Select } from '@/ui/Select';

const PANES: Record<SettingsSectionId, () => React.JSX.Element> = {
    appearance: AppearancePane,
    views: ViewsPane,
    files: FilesPane,
    providers: ProvidersPane,
    voice: VoicePane,
    computer: ComputerPane,
    usage: UsagePane,
    agents: AgentsPane,
    machines: MachinesPane,
    keyboard: KeyboardPane,
    about: AboutPane
};

/* Sections on the left, one pane on the right. Opens on the section the caller asked for, or the last one. */
export function SettingsDialog() {
    const { t } = useTranslation('shell');
    const open = useUi((s) => s.settings.open);
    const section = useUi((s) => s.settings.section);
    const setSettings = useUi((s) => s.setSettings);
    const [query, setQuery] = useState('');
    const meta = ALL_SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? ALL_SETTINGS_SECTIONS[0]!;
    // Built on every render rather than once: the words move with the language, the list does not.
    const items = ALL_SETTINGS_SECTIONS.map((entry) => ({ value: entry.id, label: sectionLabel(entry.id) }));
    const searching = query.trim() !== '';

    const pick = (result: SearchResult): void => setSettings({ section: result.section, target: result.id });

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                setSettings({ open: next });
                if (!next) {
                    setQuery('');
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                {/* The width steps down with the viewport: a narrower navigation on a tablet, and a menu of
                    sections instead of the column where even that leaves the panes too little room. */}
                <Dialog.Popup className="dialog-popup flex h-[760px] w-[1200px]">
                    <Tabs.Root
                        value={section}
                        onValueChange={(value) => setSettings({ section: value as SettingsSectionId })}
                        orientation="vertical"
                        className="flex min-h-0 min-w-0 grow max-[640px]:flex-col"
                    >
                        <div className="flex w-58 shrink-0 flex-col gap-3.5 border-r border-border bg-surface bg-clip-padding px-3 py-4 max-[960px]:w-48 max-[640px]:w-auto max-[640px]:flex-row max-[640px]:items-center max-[640px]:border-r-0 max-[640px]:border-b">
                            <Dialog.Title className="px-2.5 pt-1 text-base font-semibold text-text max-[640px]:pt-0">{t('settingsDialog.title')}</Dialog.Title>
                            <div className="contents max-[640px]:hidden">
                                <SettingsSearch query={query} onQuery={setQuery} onPick={pick} />
                                {searching ? <SettingsSearchResults query={query} onPick={pick} /> : <SettingsNav />}
                            </div>
                            <div className="min-w-0 grow min-[641px]:hidden">
                                <Select
                                    value={section}
                                    items={items}
                                    onValueChange={(value) => setSettings({ section: value })}
                                    label={t('settingsDialog.section')}
                                />
                            </div>
                        </div>
                        {/* The header sits outside the panels: inside one it remounts on every section
                            change, which throws the keyboard's focus away mid-arrow-key. */}
                        <div className="flex min-h-0 min-w-0 grow flex-col">
                            <div className="flex min-w-0 items-start gap-4 px-8 pt-5.5 pb-4.5 max-[960px]:px-4">
                                <div className="min-w-0 grow">
                                    <h2 className="text-lg font-semibold text-text">{sectionLabel(meta.id)}</h2>
                                    <p className="mt-0.5 text-xs break-words text-text-muted">{sectionDescription(meta.id)}</p>
                                </div>
                                <CloseButton label={t('settingsDialog.close')} dialog />
                            </div>
                            {ALL_SETTINGS_SECTIONS.map((entry) => {
                                const Pane = PANES[entry.id];
                                return (
                                    <Tabs.Panel
                                        key={entry.id}
                                        value={entry.id}
                                        keepMounted={false}
                                        className={clsx(
                                            'flex min-h-0 min-w-0 grow flex-col outline-none',
                                            // A split pane scrolls each of its sides itself.
                                            !entry.split && 'scroll-fade-top gap-7 overflow-y-auto px-8 pt-1 pb-10 max-[960px]:px-4'
                                        )}
                                        onScroll={(event) => event.currentTarget.toggleAttribute('data-fade-start', event.currentTarget.scrollTop > 0)}
                                    >
                                        <Pane />
                                    </Tabs.Panel>
                                );
                            })}
                        </div>
                    </Tabs.Root>
                    <Dialog.Description className="sr-only">{sectionDescription(meta.id)}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
