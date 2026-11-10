import type { MenuNode } from '@ruimte/desktop-bridge';
import type { MenuCommand } from '@/commands/menu-builders';
import type { MenuContext } from '@/commands/menu-context';
import type { MenuContainer } from '@/commands/types';

/* Rows a feature draws in a group besides the table's: a submenu, or one row per thing it holds. */
export interface MenuExtra {
    readonly menu: MenuContainer;
    readonly group: string;
    /* Its place among the rows of the group, the table's included. */
    readonly order: number;
    /* `itemsOf` builds the rows of another menu, for a submenu. */
    readonly build: (context: MenuContext, command: MenuCommand, itemsOf: (container: MenuContainer) => MenuNode[]) => MenuNode[];
}

const extras: MenuExtra[] = [];

export function registerMenuExtras(...added: readonly MenuExtra[]): void {
    extras.push(...added);
}

export function menuExtrasOf(menu: MenuContainer, group: string): readonly MenuExtra[] {
    return extras.filter((extra) => extra.menu === menu && extra.group === group);
}
