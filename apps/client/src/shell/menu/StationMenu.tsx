import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu as MenuGlyph } from 'lucide-react';
import type { MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { AgentIcon } from '@ruimte/agents-react/agents/AgentIcon';
import { runMenuCommand } from '@/shell/menu/actions';
import { menuContext } from '@/shell/menu/context';
import { menuIconOf } from '@/shell/menu/icons';
import { menuModel } from '@/shell/menu/model';
import { Brand } from '@/ui/Brand';
import { Icon, IconButton, Menu, Tooltip } from '@basmilius/desktop-ui';

/* A fixed box in front of every row, the empty one included, so every label starts on the same line. */
function RowIcon({ id }: { id: string }) {
    const icon = menuIconOf(id);
    return (
        <span className="grid w-4 shrink-0 place-items-center text-text-muted">
            {icon !== null && ('agent' in icon ? <AgentIcon kind={icon.agent} size={14} /> : <Icon icon={icon.icon} size={14} />)}
        </span>
    );
}

function Submenu({ id, label, items, disabled = false }: { id: string; label: string; items: MenuNode[]; disabled?: boolean }) {
    return (
        <Menu.SubmenuRoot disabled={disabled}>
            <Menu.SubmenuTrigger>
                <RowIcon id={id} />
                <span className="min-w-0 grow truncate">{label}</span>
            </Menu.SubmenuTrigger>
            <Menu.Popup className="min-w-56">
                <MenuRows items={items} />
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

function MenuRows({ items }: { items: MenuNode[] }) {
    return items.map((node, index) => {
        switch (node.kind) {
            case 'separator':
                return <Menu.Separator key={`separator-${index}`} />;
            case 'submenu':
                return <Submenu key={node.id} id={node.id} label={node.label} items={node.items} disabled={node.enabled === false} />;
            case 'command':
                return (
                    <Menu.Item
                        key={node.id}
                        className={node.id === 'view-delete' ? 'text-status-error' : undefined}
                        disabled={node.enabled === false}
                        onClick={() => runMenuCommand(node.id)}
                    >
                        {node.checked === undefined ? <RowIcon id={node.id} /> : <Menu.Check kind={node.radio ? 'radio' : 'checkbox'} checked={node.checked} />}
                        <span className="min-w-0 grow truncate">{node.label}</span>
                        {node.keys && <Menu.Hint>{node.keys}</Menu.Hint>}
                    </Menu.Item>
                );
            default:
                // Roles and shell actions are the desktop shell's; the model never hands one to the web client.
                return null;
        }
    });
}

/*
 * The application menu of the web client, which has no menu bar of its own: the wordmark at the top of
 * the sidebar opens it, and the same menu glyph beside the sidebar toggle once the sidebar is closed.
 * Built when it opens, so it says what has the focus at that moment.
 */
export function StationMenu({ variant }: { variant: 'wordmark' | 'symbol' }) {
    const { t } = useTranslation('shell');
    const [spec, setSpec] = useState<MenuSpec | null>(null);
    return (
        <Menu.Root onOpenChange={(open) => open && setSpec(menuModel(menuContext('station')))}>
            {variant === 'wordmark' ? (
                <Tooltip label={t('menu.open')}>
                    <Menu.Trigger
                        className="-ml-2 flex h-8 items-center gap-2 rounded-md px-2 text-text-faint hover:bg-surface-hover data-[popup-open]:bg-surface-active"
                        aria-label={t('menu.open')}
                    >
                        <Icon icon={MenuGlyph} size={16} />
                        <Brand />
                    </Menu.Trigger>
                </Tooltip>
            ) : (
                <IconButton icon={MenuGlyph} label={t('menu.open')} className="shrink-0" render={<Menu.Trigger />} />
            )}
            <Menu.Popup className="min-w-48">
                {spec?.menus.map((menu) => (
                    <Submenu key={menu.id} id={menu.id} label={menu.label} items={menu.items} />
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}
