import type { ComponentType } from 'react';
import i18next from 'i18next';
import { Brain, ChartNoAxesColumn, type LucideIcon } from 'lucide-react';
import type { SettingsSectionEntry } from '@ruimte/ui/settings/SettingsDialog';

/* A section of this package for the settings dialog of @ruimte/ui, with its words read when it is drawn. */
export interface AgentsSettingsSection {
    id: string;
    icon: LucideIcon;
    /* A list beside a detail that scrolls on its own (`MasterDetail`). */
    split?: boolean;
    label(): string;
    description(): string;
}

/* The agent CLIs of the host and the accounts they sign in with: `ProvidersPane`. */
export const PROVIDERS_SECTION: AgentsSettingsSection = {
    id: 'providers',
    icon: Brain,
    split: true,
    label: () => i18next.t('agent-providers:section.label'),
    description: () => i18next.t('agent-providers:section.description')
};

/* The currency of the usage page and the way to it: `UsagePane`. */
export const USAGE_SECTION: AgentsSettingsSection = {
    id: 'usage',
    icon: ChartNoAxesColumn,
    label: () => i18next.t('agent-usage:section.label'),
    description: () => i18next.t('agent-usage:section.description')
};

/*
 * The entry the dialog takes for a section, with the pane the app hands it: the pane of this package
 * itself, a lazy one, or a wrapper that gives the pane what only the app knows. Built when the dialog
 * draws, since the words follow the language.
 */
export const settingsSection = (section: AgentsSettingsSection, pane: ComponentType): SettingsSectionEntry => ({
    id: section.id,
    icon: section.icon,
    label: section.label(),
    description: section.description(),
    pane,
    split: section.split
});
