import { AgentIcon } from '@adecore/agents-react/providers';
import { Icon, IconButton, Menu, Tooltip } from '@adecore/ui';
import type { MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { Menu as MenuGlyph } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop } from '@/desktop/bridge';
import { runMenuCommand } from '@/shell/menu/actions';
import { menuContext } from '@/shell/menu/context';
import { menuIconOf } from '@/shell/menu/icons';
import { menuModel } from '@/shell/menu/model';
import { useBackgroundServiceState } from '@/shell/use-background-service';
import { IS_STATION } from '@/station';
import { Brand } from '@/ui/Brand';

/* A fixed box in front of every row, the empty one included, so every label starts on the same line. */
function RowIcon({ id }: { id: string }) {
    const icon = menuIconOf(id);
    return (
        <span className="grid w-4 shrink-0 place-items-center text-text-muted">
            {icon !== null && ('agent' in icon ? <AgentIcon kind={icon.agent} size={14} /> : <Icon icon={icon.icon} size={14} />)}
        </span>
    );
}

function Submenu({
    id,
    label,
    items,
    canStopMachine,
    disabled = false
}: {
    id: string;
    label: string;
    items: MenuNode[];
    canStopMachine: boolean;
    disabled?: boolean;
}) {
    return (
        <Menu.SubmenuRoot disabled={disabled}>
            <Menu.SubmenuTrigger>
                <RowIcon id={id} />
                <span className="min-w-0 grow truncate">{label}</span>
            </Menu.SubmenuTrigger>
            <Menu.Popup className="min-w-56">
                <MenuRows items={items} canStopMachine={canStopMachine} />
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

function MenuRows({ items, canStopMachine }: { items: MenuNode[]; canStopMachine: boolean }) {
    return items.map((node, index) => {
        switch (node.kind) {
            case 'separator':
                return <Menu.Separator key={`separator-${index}`} />;
            case 'submenu':
                return (
                    <Submenu
                        key={node.id}
                        id={node.id}
                        label={node.label}
                        items={node.items}
                        canStopMachine={canStopMachine}
                        disabled={node.enabled === false}
                    />
                );
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
            case 'role':
                // The other roles have keys the shell keeps under a hidden menu bar, so only Quit needs a row here.
                return node.role === 'quit' && desktop()?.quit ? (
                    <Menu.Item key={node.role} onClick={() => desktop()?.quit?.()}>
                        <RowIcon id="quit" />
                        <span className="min-w-0 grow truncate">{node.label}</span>
                    </Menu.Item>
                ) : null;
            case 'shell':
                // The same test as the native menu's `canStopMachine`, and no confirmation, as there.
                return node.action === 'stop-machine-and-quit' && canStopMachine ? (
                    <Menu.Item key={node.action} onClick={() => desktop()?.backgroundService?.stopMachine()}>
                        <RowIcon id="stop-machine-and-quit" />
                        <span className="min-w-0 grow truncate">{node.label}</span>
                    </Menu.Item>
                ) : null;
        }
    });
}

/*
 * The application menu where no menu bar shows, in the web client and on Windows: the wordmark at the top of
 * the sidebar opens it, and the same menu glyph beside the sidebar toggle once the sidebar is closed.
 * Built when it opens, so it says what has the focus at that moment.
 */
export function StationMenu({ variant }: { variant: 'wordmark' | 'symbol' }) {
    const { t } = useTranslation('shell');
    const [spec, setSpec] = useState<MenuSpec | null>(null);
    // Read here rather than in the rows, so the answer is in before the menu opens and the row does not jump in.
    const canStopMachine = useBackgroundServiceState()?.support === 'supported';
    return (
        <Menu.Root onOpenChange={(open) => open && setSpec(menuModel(menuContext(IS_STATION ? 'station' : 'desktop')))}>
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
                    <Submenu key={menu.id} id={menu.id} label={menu.label} items={menu.items} canStopMachine={canStopMachine} />
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}
