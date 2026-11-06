import type { Shortcut } from '@adecore/ui';
import type { MenuNode, MenuRole, MenuShellAction } from '@ruimte/desktop-bridge';
import i18next from 'i18next';

export type MenuCommand = (id: string, label: string, options?: CommandOptions) => MenuNode;

export interface CommandOptions {
    shortcut?: Shortcut;
    enabled?: boolean;
    checked?: boolean;
    radio?: boolean;
}

export function t(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`shell:menu.${key}`, options ?? {});
}

export const separator: MenuNode = { kind: 'separator' };

export function role(name: MenuRole, label: string): MenuNode {
    return { kind: 'role', role: name, label };
}

export function shell(action: MenuShellAction, label: string): MenuNode {
    return { kind: 'shell', action, label };
}

export function submenu(id: string, label: string, items: MenuNode[], enabled?: boolean): MenuNode {
    return {
        kind: 'submenu',
        id,
        label,
        items: tidy(items),
        ...(enabled === undefined ? {} : { enabled })
    };
}

/* No line at either end and never two in a row, so a group that is not offered takes its line with it. */
export function tidy(items: MenuNode[]): MenuNode[] {
    return items.filter(
        (item, index) =>
            item.kind !== 'separator' ||
            (index > 0 &&
                index < items.length - 1 &&
                items[index - 1]!.kind !== 'separator' &&
                items.slice(index + 1).some((next) => next.kind !== 'separator'))
    );
}

export function only(condition: boolean, ...items: MenuNode[]): MenuNode[] {
    return condition ? items : [];
}
