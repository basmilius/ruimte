import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

/* A row the settings search can find. A pane draws only while it is open, so each row is named by its words here. */
export interface SettingsSearchRow {
    readonly id: string;
    readonly section: string;
    /* Full i18n keys, namespace included. */
    readonly label: string;
    readonly description?: string;
    /* A row the pane only draws where it can act, so a result never leads to nothing. */
    readonly available?: () => boolean;
}

/* A row whose id is also where its words sit, under `settings:<id>.label` and `.description`, in the pane its id starts with. */
export function settingsRow(id: `${string}.${string}`, available?: () => boolean): SettingsSearchRow {
    return {
        id,
        section: id.slice(0, id.indexOf('.')),
        label: `settings:${id}.label`,
        description: `settings:${id}.description`,
        ...(available === undefined ? {} : { available })
    };
}

/*
 * The navigation group a section sits in: the first goes without a label, `workspace` and `ai` have one.
 * The footer holds the app itself and the account is the block under it.
 */
export type SettingsSlot = 'general' | 'workspace' | 'ai' | 'footer' | 'account';

export interface SettingsSectionDefinition {
    readonly id: string;
    readonly slot: SettingsSlot;
    readonly icon: LucideIcon;
    readonly split?: boolean;
    /* Read when a section is drawn, never at module level: the translations are not in yet while this file loads. */
    readonly label: () => string;
    readonly description: () => string;
    /* A chunk of its own, loaded when the pane is opened; the search never imports one. */
    readonly pane: ComponentType;
    /* From the pane's own module, so a hero loads with its pane. */
    readonly hero?: ComponentType;
    readonly rows: readonly SettingsSearchRow[];
}

export const settingsSectionRegistry = createRegistry<SettingsSectionDefinition>('settings section');
