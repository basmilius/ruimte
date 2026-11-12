import type { KeymapId } from '@adecore/editor/keymap';
import type { Shortcut } from '@adecore/ui';
import type { LucideIcon } from 'lucide-react';
import type { MenuContext } from '@/commands/menu-context';
import type { DefaultKeyId } from '@/surface/default-keys';

/* A menu of the bar or a submenu with a fixed place, whose groups `shell/menu/model.ts` lays out. */
export type MenuContainer =
    | 'app'
    | 'file'
    | 'new-view'
    | 'edit'
    | 'code'
    | 'completion'
    | 'ai'
    | 'templates'
    | 'folding'
    | 'expand-to-level'
    | 'edit-lines'
    | 'selection'
    | 'view'
    | 'kind'
    | 'chat-move'
    | 'go'
    | 'run'
    | 'launches-after-settle'
    | 'window'
    | 'help'
    | 'keep-awake'
    | 'layouts';

interface MenuWords {
    key: string;
    values?: Record<string, string>;
}

/* Where a command sits in the menu tree, and what the menu reads off the moment for it. */
export interface MenuPlace {
    readonly menu: MenuContainer;
    /* Groups are drawn in the order `shell/menu/model.ts` gives them, with a line between two that have rows. */
    readonly group: string;
    /* Its place among the rows of the group, the generated ones included. */
    readonly order: number;
    readonly when?: (context: MenuContext) => boolean;
    /* Undefined leaves the field out, which the shell reads as enabled. */
    readonly enabled?: (context: MenuContext) => boolean | undefined;
    readonly checked?: (context: MenuContext) => boolean;
    readonly radio?: true;
    /* Words that follow the moment, in place of `shell:menu.<key>`. */
    readonly words?: (context: MenuContext) => MenuWords;
    /* Whether the row shows its shortcut now. The key is bound regardless. */
    readonly showsShortcut?: (context: MenuContext) => boolean;
    /* A key the row shows in place of the command's, for one that whatever has the focus answers by itself. */
    readonly shortcut?: (context: MenuContext) => Shortcut | undefined;
}

/*
 * One command a person can give from the menu, the palette or the keyboard: its words, icon, key and place.
 * A feature declares its rows in its own `command-table.ts` and what they do in its `commands.ts`
 * (`commands/behavior.ts`). Its words are `shell:menu.<key>` and `shell:palette.commands.<key>`.
 */
export interface CommandSpec {
    readonly key: string;
    readonly icon: LucideIcon;
    /*
     * A key the row has for good, which no one rebinds: one a composer answers by itself. The keys a person may
     * rebind are the row's default in `surface/default-keys.ts`, or the key of the editor's keymap named by `keymap`.
     */
    readonly shortcut?: Shortcut;
    /* Another row whose key this one shows, so the two move together. */
    readonly keyOf?: DefaultKeyId;
    /* The key of the editor's keymap that answers the row, which a person may rebind. */
    readonly keymap?: KeymapId;
    /* Keys the row answers besides its own, until a person rebinds it. */
    readonly aliases?: readonly Shortcut[];
    /*
     * The listener that binds the shortcut, once on `window`: the window's own, which the start screen has
     * too, or the workspace's. Without it the row only shows the key, and whatever has the focus answers it
     * (the editor, a composer).
     */
    readonly binds?: 'window' | 'workspace';
    /* Only its key reaches the row: no palette row, no menu row. */
    readonly keyOnly?: true;
    /* The palette has a row for it; without one the menu runs it itself. */
    readonly palette: boolean;
    readonly menu?: MenuPlace | readonly MenuPlace[];
}
