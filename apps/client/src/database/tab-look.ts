import i18next from 'i18next';
import { Eye, PencilRuler, Table, TableProperties, type LucideIcon } from 'lucide-react';
import type { DatabaseTab } from '@/state/files';

/* The glyph of a database tab, the same the explorer draws a table and a view with. */
export function databaseTabIcon(tab: DatabaseTab): LucideIcon {
    switch (tab.kind) {
        case 'table':
            return tab.tableKind === 'view' ? Eye : Table;
        case 'structure':
            return TableProperties;
        case 'designer':
            return PencilRuler;
    }
}

/* What a database tab is called in the strip, which names the table and what of it the tab shows. */
export function databaseTabTitle(tab: DatabaseTab): string {
    switch (tab.kind) {
        case 'table':
            return tab.where === undefined ? tab.table : i18next.t('databases:tab.filtered', { table: tab.table });
        case 'structure':
            return i18next.t('databases:tab.structure', { table: tab.table });
        case 'designer':
            return tab.table === undefined ? i18next.t('databases:tab.newTable') : i18next.t('databases:tab.design', { table: tab.table });
    }
}
