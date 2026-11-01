import { createElement } from 'react';
import { Package } from 'lucide-react';
import { Button, ContextMenu, Icon, IconButton, Menu, Spinner } from '@adecore/ui';
import { runAction, useActionRuns } from '@/extensions/action-runs';
import { useContributions, type ActionContribution, type ActionMenuContribution, type ActionPlace } from '@/extensions/registry';
import { useCanvas } from '@/state/canvas';

/* What an extension chose to show at one place, for these nodes. */
function useActionsAt(place: ActionPlace, nodeIds: readonly string[]) {
    const actions = useContributions((state) => state.actions);
    const menus = useContributions((state) => state.actionMenus);
    const itemsOf = (menu: ActionMenuContribution) => menu.items.flatMap((id) => actions.filter((action) => action.id === id && action.when(nodeIds)));

    return {
        actions: actions.filter((action) => action.show.includes(place) && action.when(nodeIds)),
        menus: menus
            .filter((menu) => menu.show.includes(place))
            .map((menu) => ({ menu, items: itemsOf(menu) }))
            .filter(({ items }) => items.length > 0)
    };
}

function useRunning(action: ActionContribution): boolean {
    return useActionRuns((state) => state.runs.some((run) => run.actionId === action.id));
}

function ActionIcon({ action }: { action: Pick<ActionContribution, 'icon'> }) {
    return action.icon === undefined ? null : <Icon icon={action.icon} size={14} />;
}

function BarButton({ action, nodeIds }: { action: ActionContribution; nodeIds: readonly string[] }) {
    const running = useRunning(action);

    return (
        <Button variant="ghost" size="sm" disabled={running} onClick={() => runAction(action, nodeIds)}>
            {running ? <Spinner size={14} /> : <ActionIcon action={action} />}
            {action.title}
        </Button>
    );
}

function DropdownItems({ items, nodeIds }: { items: readonly ActionContribution[]; nodeIds: readonly string[] }) {
    return items.map((action) => (
        <Menu.Item key={action.id} onClick={() => runAction(action, nodeIds)}>
            <ActionIcon action={action} /> {action.title}
        </Menu.Item>
    ));
}

/* The bar over the canvas. It stays out of the way until something is selected that an extension acts on. */
export function ActionBar() {
    const selection = useCanvas((state) => state.selection);
    const { actions, menus } = useActionsAt('selectionBar', selection);

    if (selection.length === 0 || (actions.length === 0 && menus.length === 0)) {
        return null;
    }

    return (
        <div
            className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
            // A press here is no press on the canvas, which would drop the selection this acts on.
            onPointerDown={(event) => event.stopPropagation()}
        >
            {actions.map((action) => (
                <BarButton key={action.id} action={action} nodeIds={selection} />
            ))}
            {menus.map(({ menu, items }) => (
                <Menu.Root key={menu.id}>
                    <Menu.Trigger render={<Button variant="ghost" size="sm" />}>
                        <ActionIcon action={menu} />
                        {menu.title}
                    </Menu.Trigger>
                    <Menu.Popup className="min-w-44">
                        <DropdownItems items={items} nodeIds={selection} />
                    </Menu.Popup>
                </Menu.Root>
            ))}
        </div>
    );
}

function HeaderButton({ action, nodeId }: { action: ActionContribution; nodeId: string }) {
    const running = useRunning(action);

    return <IconButton icon={action.icon ?? Package} size="sm" label={action.title} disabled={running} onClick={() => runAction(action, [nodeId])} />;
}

/* What extensions put in a node's header, and the sign that one is working on this node. */
export function NodeHeaderExtras({ nodeId }: { nodeId: string }) {
    const headers = useContributions((state) => state.nodeHeaders);
    const run = useActionRuns((state) => state.runs.find((each) => each.nodeIds.includes(nodeId)));
    const { actions, menus } = useActionsAt('nodeHeader', [nodeId]);

    return (
        <>
            {run !== undefined && <Spinner size={14} label={run.title} className="shrink-0" />}
            {headers
                .filter((header) => header.when(nodeId))
                .map((header) => (
                    <span key={header.id} className="flex shrink-0 items-center">
                        {createElement(header.component, { nodeId })}
                    </span>
                ))}
            {actions.map((action) => (
                <HeaderButton key={action.id} action={action} nodeId={nodeId} />
            ))}
            {menus.map(({ menu, items }) => (
                <Menu.Root key={menu.id}>
                    <IconButton render={<Menu.Trigger />} icon={menu.icon ?? Package} size="sm" label={menu.title} />
                    <Menu.Popup className="min-w-44">
                        <DropdownItems items={items} nodeIds={[nodeId]} />
                    </Menu.Popup>
                </Menu.Root>
            ))}
        </>
    );
}

/* Low in a node's menu, under what Ruimte offers itself and above removing it, so an extension never moves Ruimte's own items. */
export function NodeMenuExtensions({ nodeIds }: { nodeIds: readonly string[] }) {
    const { actions, menus } = useActionsAt('nodeMenu', nodeIds);

    if (actions.length === 0 && menus.length === 0) {
        return null;
    }

    return (
        <>
            <ContextMenu.Separator />
            {actions.map((action) => (
                <ContextMenu.Item key={action.id} onClick={() => runAction(action, nodeIds)}>
                    <ActionIcon action={action} /> {action.title}
                </ContextMenu.Item>
            ))}
            {menus.map(({ menu, items }) => (
                <ContextMenu.SubmenuRoot key={menu.id}>
                    <ContextMenu.SubmenuTrigger>
                        <ActionIcon action={menu} /> {menu.title}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup className="min-w-44">
                        {items.map((action) => (
                            <ContextMenu.Item key={action.id} onClick={() => runAction(action, nodeIds)}>
                                <ActionIcon action={action} /> {action.title}
                            </ContextMenu.Item>
                        ))}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            ))}
        </>
    );
}
