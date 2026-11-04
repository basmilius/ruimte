import { Button, ContextMenu, Icon, IconButton, Menu, Pill, Spinner, Tooltip } from '@adecore/ui';
import { Blocks, Package, Square } from 'lucide-react';
import { createElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isRunning, nodeIdsOf, runAction, useActionRuns } from '@/extensions/action-runs';
import { useContributions, type SlotEntry, type SlotMenuItem, type SlotName } from '@/extensions/registry';
import { useSlotOutlines } from '@/extensions/slot-outlines';
import { nodeInfoOf, resolveSlot, useSlot, type ResolvedEntry } from '@/extensions/slots';
import { useCanvas } from '@/state/canvas';

type MenuKit = typeof Menu | typeof ContextMenu;

function useEntryRunning(entry: SlotEntry, context: object): boolean {
    return useActionRuns((state) => isRunning(state.runs, entry.id, nodeIdsOf(context)));
}

/* Asked in render, so a throw is caught here as `resolveSlot` catches one: it costs only this menu's items. */
function menuItemsOf(entry: SlotEntry, context: object): readonly SlotMenuItem[] {
    if (typeof entry.items !== 'function') {
        return entry.items ?? [];
    }

    try {
        return entry.items(context);
    } catch (e) {
        entry.onFailure?.(e instanceof Error ? e.message : String(e));

        return [];
    }
}

/* An item that names an action which is gone, or one a menu's own context has no use for, is left out. */
function MenuItems({ kit: Kit, items, context, slot }: { kit: MenuKit; items: readonly SlotMenuItem[]; context: object; slot: SlotName }) {
    const entries = useContributions((state) => state.slotEntries);

    return items.map((item, index) => {
        if (item === 'separator') {
            // oxlint-disable-next-line react/no-array-index-key -- Separators have nothing else to tell them apart.
            return <Kit.Separator key={index} />;
        }

        if ('actionId' in item) {
            const action = entries.find((entry) => entry.id === item.actionId);
            // What the action's own slot here says, when it has one, also whether it can run.
            const disabled = action === undefined ? false : (resolveSlot([action], slot, context)[0]?.disabled ?? false);

            return action === undefined ? null : (
                <Kit.Item key={action.id} disabled={disabled} onClick={() => void runAction(action, context, slot)}>
                    {action.icon !== undefined && <Icon icon={action.icon} size={14} />} {action.title}
                </Kit.Item>
            );
        }

        if ('items' in item) {
            return (
                <Kit.SubmenuRoot key={item.title}>
                    <Kit.SubmenuTrigger>{item.title}</Kit.SubmenuTrigger>
                    <Kit.Popup className="min-w-44">
                        <MenuItems kit={Kit} items={item.items} context={context} slot={slot} />
                    </Kit.Popup>
                </Kit.SubmenuRoot>
            );
        }

        return (
            <Kit.Item key={item.title} onClick={item.run}>
                {item.checked !== undefined && <Kit.Check kind="checkbox" checked={item.checked} />}
                {item.title}
            </Kit.Item>
        );
    });
}

function BarButton({ resolved, context, slot }: { resolved: ResolvedEntry; context: object; slot: SlotName }) {
    const { entry, title, icon, disabled, badge } = resolved;
    const running = useEntryRunning(entry, context);

    return (
        <Button variant="ghost" size="sm" disabled={disabled || running} onClick={() => void runAction({ ...entry, title }, context, slot)}>
            {running ? <Spinner size={14} /> : icon !== undefined && <Icon icon={icon} size={14} />}
            {title}
            {badge !== undefined && <Pill>{badge}</Pill>}
        </Button>
    );
}

function IconAction({ resolved, context, slot }: { resolved: ResolvedEntry; context: object; slot: SlotName }) {
    const { entry, title, icon, disabled, disabledReason } = resolved;
    const running = useEntryRunning(entry, context);

    return (
        <IconButton
            icon={icon ?? Package}
            size="sm"
            label={disabledReason ?? title}
            disabled={disabled || running}
            onClick={() => void runAction({ ...entry, title }, context, slot)}
        />
    );
}

function Widget({ entry, context }: { entry: SlotEntry; context: object }) {
    return entry.component === undefined ? null : createElement(entry.component, { context, nodeId: (context as { node?: { id: string } }).node?.id });
}

/* One entry in a row of buttons, with words beside its icon or the icon alone. */
function RowEntry({ resolved, context, slot, words }: { resolved: ResolvedEntry; context: object; slot: SlotName; words: boolean }) {
    const { entry, title, icon, disabled } = resolved;

    if (entry.kind === 'widget') {
        return <Widget entry={entry} context={context} />;
    }

    if (entry.kind === 'menu') {
        return (
            <Menu.Root disabled={disabled}>
                {words ? (
                    <Menu.Trigger render={<Button variant="ghost" size="sm" />}>
                        {icon !== undefined && <Icon icon={icon} size={14} />}
                        {title}
                    </Menu.Trigger>
                ) : (
                    <IconButton render={<Menu.Trigger />} icon={icon ?? Package} size="sm" label={title} />
                )}
                <Menu.Popup className="min-w-44">
                    <MenuItems kit={Menu} items={menuItemsOf(entry, context)} context={context} slot={slot} />
                </Menu.Popup>
            </Menu.Root>
        );
    }

    return words ? <BarButton resolved={resolved} context={context} slot={slot} /> : <IconAction resolved={resolved} context={context} slot={slot} />;
}

function SlotLabel({ place, context }: { place: SlotName; context: object }) {
    return (
        <Tooltip label={Object.keys(context).join(', ')}>
            <span
                data-slot-outline={place}
                className="inline-flex shrink-0 items-center rounded-sm border border-dashed border-accent px-1 text-xs text-accent"
            >
                {place}
            </span>
        </Tooltip>
    );
}

/* What extensions put in a bar: icons only in a tight one, words where there is room. */
export function SlotRow({ place, context, words = false, wrap }: { place: SlotName; context: object; words?: boolean; wrap?: (row: ReactNode) => ReactNode }) {
    const { resolved, full } = useSlot(place, context);
    const outlined = useSlotOutlines((state) => state.on);

    if (resolved.length === 0 && !outlined) {
        return null;
    }

    const row = (
        <>
            {outlined && <SlotLabel place={place} context={full} />}
            {resolved.map((each) => (
                <RowEntry key={each.entry.id} resolved={each} context={full} slot={place} words={words} />
            ))}
        </>
    );

    return wrap === undefined ? row : wrap(row);
}

/* What extensions put in a menu, under a line of its own and so always below what Ruimte offers there. */
export function SlotMenuItems({ place, context, kit: Kit = ContextMenu }: { place: SlotName; context: object; kit?: MenuKit }) {
    const { resolved: all, full } = useSlot(place, context);
    const resolved = all.filter(({ entry }) => entry.addsNode !== true);
    const outlined = useSlotOutlines((state) => state.on);

    if (resolved.length === 0 && !outlined) {
        return null;
    }

    return (
        <>
            <Kit.Separator />
            {outlined && (
                <div className="px-2 py-1">
                    <SlotLabel place={place} context={full} />
                </div>
            )}
            {resolved.map(({ entry, title, icon, disabled }) => {
                if (entry.kind === 'widget') {
                    // Your own React is at home in a menu too: a row that is no item, so it stays open while you use it.
                    return (
                        <div key={entry.id} className="px-2 py-1">
                            <Widget entry={entry} context={full} />
                        </div>
                    );
                }

                if (entry.kind === 'menu') {
                    return (
                        <Kit.SubmenuRoot key={entry.id} disabled={disabled}>
                            <Kit.SubmenuTrigger>
                                {icon !== undefined && <Icon icon={icon} size={14} />} {title}
                            </Kit.SubmenuTrigger>
                            <Kit.Popup className="min-w-44">
                                <MenuItems kit={Kit} items={menuItemsOf(entry, full)} context={full} slot={place} />
                            </Kit.Popup>
                        </Kit.SubmenuRoot>
                    );
                }

                return (
                    <Kit.Item key={entry.id} disabled={disabled} onClick={() => void runAction({ ...entry, title }, full, place)}>
                        {icon !== undefined && <Icon icon={icon} size={14} />} {title}
                    </Kit.Item>
                );
            })}
        </>
    );
}

/* Every node an extension adds, together under one submenu, so they never mix with what Ruimte makes itself. */
export function ExtensionNodesSubmenu({ at }: { at: { x: number; y: number } }) {
    const { t } = useTranslation('canvas');
    const { resolved, full } = useSlot('canvasMenu', { at });
    const nodes = resolved.filter(({ entry }) => entry.addsNode === true);

    if (nodes.length === 0) {
        return null;
    }

    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={Blocks} size={14} /> {t('canvasMenu.extensions')}
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Popup className="min-w-44">
                {nodes.map(({ entry, title, icon, disabled }) => (
                    <ContextMenu.Item key={entry.id} disabled={disabled} onClick={() => void runAction({ ...entry, title }, full, 'canvasMenu')}>
                        {icon !== undefined && <Icon icon={icon} size={14} />} {title}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

/* The bar over the canvas. It stays out of the way until something is selected that an extension acts on. */
export function SelectionBar() {
    const selection = useCanvas((state) => state.selection);

    return (
        <SlotRow
            place="selectionBar"
            words
            context={{ nodes: selection.map(nodeInfoOf) }}
            wrap={(row) =>
                selection.length === 0 ? null : (
                    <div
                        className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
                        // A press here is no press on the canvas, which would drop the selection this acts on.
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        {row}
                    </div>
                )
            }
        />
    );
}

/* The sign that an extension works on this node, which also stops it. */
function RunSign({ nodeId }: { nodeId: string }) {
    const { t } = useTranslation('shell');
    const run = useActionRuns((state) => state.runs.find((each) => each.nodeIds.includes(nodeId)));

    if (run === undefined) {
        return null;
    }

    return (
        <span className="group/run relative flex shrink-0 items-center" data-run-sign>
            <Spinner size={14} label={run.title} />
            <IconButton
                icon={Square}
                size="sm"
                label={t('extensions.stopRun', { title: run.title })}
                className="absolute inset-0 opacity-0 group-hover/run:opacity-100"
                onClick={() => run.controller.abort()}
            />
        </span>
    );
}

export function NodeHeaderSlot({ nodeId }: { nodeId: string }) {
    return (
        <>
            <RunSign nodeId={nodeId} />
            <SlotRow place="nodeHeader" context={{ node: nodeInfoOf(nodeId) }} />
        </>
    );
}

/* Right on a node in the selection means the selection, as for delete. */
export function NodeMenuSlot({ nodeId }: { nodeId: string }) {
    const selection = useCanvas((state) => state.selection);
    const ids = selection.includes(nodeId) ? selection : [nodeId];

    return <SlotMenuItems place="nodeMenu" context={{ node: nodeInfoOf(nodeId), nodes: ids.map(nodeInfoOf) }} />;
}
