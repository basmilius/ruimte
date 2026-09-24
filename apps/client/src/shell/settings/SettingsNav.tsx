import { Fragment } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SECTIONS, sectionLabel } from '@/shell/settings/sections';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

/* The left column: one tab per section, arrow keys move between them (Base UI Tabs handles the roving
   focus, and a separator is no tab, so the keys pass over it). */
export function SettingsNav() {
    const { t } = useTranslation('settings');

    return (
        <Tabs.List aria-label={t('sections.title')} activateOnFocus className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((group, index) => (
                <Fragment key={group[0]!.id}>
                    {index > 0 && (
                        <div className="px-2.5 py-1.5">
                            <Separator orientation="horizontal" />
                        </div>
                    )}
                    {group.map((section) => (
                        <Tabs.Tab
                            key={section.id}
                            value={section.id}
                            className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted hover:bg-surface-hover hover:text-text data-active:bg-surface-active data-active:text-text"
                        >
                            <Icon icon={section.icon} size={16} className="shrink-0 text-text-faint" />
                            <span className="truncate">{sectionLabel(section.id)}</span>
                        </Tabs.Tab>
                    ))}
                </Fragment>
            ))}
        </Tabs.List>
    );
}
