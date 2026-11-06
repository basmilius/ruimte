import type { MenuExtra } from '@/commands/menu-extras';
import { viewShortcut } from '@/surface/canvas/shortcuts';

/* The Go menu's row per view, which shows that view. */
export const GO_VIEW_PREFIX = 'go-view-';

export const VIEW_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'go',
        group: 'go-view',
        order: 10,
        build: (context, command) =>
            context.views.slice(0, 9).map((name, index) => command(`${GO_VIEW_PREFIX}${index + 1}`, name, { shortcut: viewShortcut(index) }))
    }
];
