import { only, submenu, t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';

export const CANVAS_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'kind',
        group: 'canvas-arrange',
        order: 40,
        build: (context, command) =>
            only(
                context.moveTargets.length > 0,
                submenu(
                    'move-to',
                    t('moveTo'),
                    context.moveTargets.map((target) => command(`view-move-${target.id}`, target.name))
                )
            )
    },
    {
        menu: 'kind',
        group: 'canvas-layout',
        order: 20,
        build: (_context, _command, itemsOf) => [submenu('layouts', t('layouts'), itemsOf('layouts'))]
    },
    { menu: 'layouts', group: 'apply', order: 10, build: (context, command) => context.layouts.map((name) => command(`layout-apply-${name}`, name)) },
    {
        menu: 'layouts',
        group: 'delete',
        order: 10,
        build: (context, command) =>
            only(
                context.layouts.length > 0,
                submenu(
                    'delete-layout',
                    t('deleteLayout'),
                    context.layouts.map((name) => command(`layout-delete-${name}`, name))
                )
            )
    }
];
