import { TerminalDictationButton } from '@/dictation/TerminalDictationButton';
import { useDictation } from '@/dictation/controller';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Globe, LayoutGrid, LayoutTemplate, Lock, LockOpen, MessageSquare, Plus, Save, StickyNote, Terminal, Type, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { isCanvasView } from '@ruimte/contracts';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import { toWorld } from '@/canvas/math';
import { LOCK_KEYS, lockHint, lockLabel } from '@/canvas/locks';
import type { StoreApi } from 'zustand';
import { useCanvas, useCanvasStore, type CanvasState, type NodeKind } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { StatusSummary } from '@/shell/StatusSummary';
import { BTN_GROUP, MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Kbd } from '@/ui/Kbd';
import { ZoomControls } from '@/ui/ZoomControls';

const centerWorld = (store: StoreApi<CanvasState>) => {
    const s = store.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

/*
 * The canvas's own controls: zoom, locks, layouts and the plus that adds a node. A view of its own
 * has no canvas under it, so the dock stays away there; its counters are the sidebar's "Needs you"
 * section, and the way out of a body is Escape, the shortcut a terminal uses, or its row in the list.
 */
export function Dock({ onHiddenChange }: { onHiddenChange?: (hidden: boolean) => void }) {
    const { t } = useTranslation(['shell', 'common']);
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    /* The canvas under this dock. It is drawn in the focused cell only, so the focused editor would
       answer the same today, but reading the cell keeps that a coincidence rather than a rule. */
    const canvasStore = useCanvasStore();
    /* A project whose views all went has no canvas either, and these controls would act on one nothing saves. */
    const onCanvas = useDocument((s) => {
        const view = activeViewOf(s);
        return view !== null && isCanvasView(view);
    });
    const { zoom, locks, hasSelection, layouts } = useCanvas(
        useShallow((s) => ({
            zoom: s.camera.zoom,
            locks: s.locks,
            hasSelection: s.selection.length > 0,
            layouts: s.layouts
        }))
    );
    const terminalId = useCanvas((s) => {
        const id = s.bodyFocusId ?? (s.selection.length === 1 ? s.selection[0] : null);
        return id && s.nodes[id]?.kind === 'terminal' && !s.hidden.has(id) ? id : null;
    });
    const anyLocked = Object.values(locks).some(Boolean);
    const allLocked = Object.values(locks).every(Boolean);

    const add = (kind: NodeKind) => {
        canvasStore.getState().addNode(kind, centerWorld(canvasStore));
    };

    if (!onCanvas) {
        return null;
    }
    return (
        <DockShell onHiddenChange={onHiddenChange}>
            <StatusSummary />

            <Menu.Root>
                <Tooltip label={t('dock.add')} name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={Plus} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="start">
                        <Menu.Popup className="menu-popup">
                            <Menu.Item className="menu-item" onClick={() => add('terminal')}>
                                <Icon icon={Terminal} size={14} /> {t('nodeKinds.terminal')} <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('chat')}>
                                <Icon icon={MessageSquare} size={14} /> {t('nodeKinds.chat')} <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                            </Menu.Item>
                            <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, centerWorld(canvasStore))} />
                            <Menu.Item className="menu-item" onClick={() => add('browser')}>
                                <Icon icon={Globe} size={14} /> {t('nodeKinds.browser')} <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('group')}>
                                <Icon icon={LayoutGrid} size={14} /> {t('nodeKinds.group')} <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('note')}>
                                <Icon icon={StickyNote} size={14} /> {t('nodeKinds.note')} <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
                            </Menu.Item>
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <Menu.Item className="menu-item" onClick={() => canvasStore.getState().addText(centerWorld(canvasStore))}>
                                <Icon icon={Type} size={14} /> {t('nodeKinds.text')} <span className={MENU_HINT}>{t('dock.doubleClick')}</span>
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <Separator />

            <ZoomControls
                zoom={zoom}
                labels={{
                    out: t('dock.zoomOut'),
                    in: t('dock.zoomIn'),
                    presets: t('dock.zoomPresets'),
                    fit: t('dock.zoomToFit'),
                    fitEverything: t('dock.fitEverything')
                }}
                shortcuts={CANVAS_SHORTCUTS}
                onZoomTo={(next) => canvasStore.getState().zoomTo(next)}
                onFitAll={() => canvasStore.getState().fitAll()}
                selection={{
                    label: t('dock.zoomToSelection'),
                    shortcut: CANVAS_SHORTCUTS.zoomSelection,
                    enabled: hasSelection,
                    onZoom: () => canvasStore.getState().zoomToSelection()
                }}
            />
            <Separator />

            {dictationEnabled && (
                <>
                    <div className={BTN_GROUP}>
                        <TerminalDictationButton terminalId={terminalId} />
                    </div>
                    <Separator />
                </>
            )}

            <div className={BTN_GROUP}>
                <Menu.Root>
                    <Tooltip label={t('dock.lock')} name>
                        <Menu.Trigger className="icon-btn" data-active={anyLocked}>
                            {anyLocked ? <Icon icon={Lock} size={16} /> : <Icon icon={LockOpen} size={16} />}
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="end">
                            <Menu.Popup className="menu-popup">
                                <div className={MENU_LABEL}>{t('dock.refuseGestures')}</div>
                                {LOCK_KEYS.map((key) => (
                                    <Menu.CheckboxItem
                                        key={key}
                                        className="menu-item"
                                        checked={locks[key]}
                                        onCheckedChange={() => canvasStore.getState().toggleLock(key)}
                                        closeOnClick={false}
                                    >
                                        <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                            <Menu.CheckboxItemIndicator>
                                                <Icon icon={Check} size={12} />
                                            </Menu.CheckboxItemIndicator>
                                        </span>
                                        <span>
                                            <span className="block">{lockLabel(key)}</span>
                                            <span className="block text-xs text-text-faint">{lockHint(key)}</span>
                                        </span>
                                    </Menu.CheckboxItem>
                                ))}
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => canvasStore.getState().setAllLocks(!allLocked)}>
                                    {allLocked ? <Icon icon={LockOpen} size={14} /> : <Icon icon={Lock} size={14} />}
                                    {allLocked ? t('dock.unlockEverything') : t('dock.lockEverything')}
                                </Menu.Item>
                                <div className="px-2.5 pb-1.5 pt-1 text-xs text-text-faint">{t('dock.lockHint')}</div>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <Menu.Root>
                    <Tooltip label={t('dock.layouts')} name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={LayoutTemplate} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="end">
                            <Menu.Popup className="menu-popup min-w-48">
                                <div className={MENU_LABEL}>{t('dock.savedLayouts')}</div>
                                {layouts.length === 0 && <div className="px-2.5 pb-1.5 text-xs text-text-faint">{t('dock.noLayouts')}</div>}
                                {layouts.map((layout) => (
                                    <Menu.Item key={layout.name} className="menu-item group" onClick={() => canvasStore.getState().applyLayout(layout.name)}>
                                        <Icon icon={LayoutTemplate} size={14} className="text-text-faint" />
                                        <span className="truncate">{layout.name}</span>
                                        <Tooltip label={t('common:action.delete')} name>
                                            <span
                                                role="button"
                                                className="ml-auto grid h-5 w-5 place-items-center rounded text-text-faint opacity-0 hover:bg-surface-hover hover:text-text group-hover:opacity-100 group-data-[highlighted]:opacity-100"
                                                onClick={(e) => {
                                                    // The row applies; only the corner deletes.
                                                    e.stopPropagation();
                                                    canvasStore.getState().deleteLayout(layout.name);
                                                }}
                                            >
                                                <Icon icon={X} size={14} />
                                            </span>
                                        </Tooltip>
                                    </Menu.Item>
                                ))}
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                                    <Icon icon={Save} size={14} /> {t('dock.saveLayout')}
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
        </DockShell>
    );
}
