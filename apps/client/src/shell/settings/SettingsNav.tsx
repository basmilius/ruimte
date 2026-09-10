import { Tabs } from '@base-ui-components/react/tabs';
import { SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { Icon } from '@/ui/Icon';

/* The left column: one tab per section, arrow keys move between them (Base UI Tabs handles the roving focus). */
export function SettingsNav() {
    return (
        <Tabs.List aria-label="Settings sections" activateOnFocus className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((section) => (
                <Tabs.Tab
                    key={section.id}
                    value={section.id}
                    className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted outline-none transition-colors hover:bg-surface-sunken hover:text-text focus-visible:ring-2 focus-visible:ring-accent data-active:bg-surface-sunken data-active:text-text"
                >
                    <Icon icon={section.icon} size={15} className="shrink-0 text-text-faint" />
                    {section.label}
                </Tabs.Tab>
            ))}
        </Tabs.List>
    );
}
