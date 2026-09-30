import { TerminalDictationButton } from '@/dictation/TerminalDictationButton';
import { useDictation } from '@/dictation/controller';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { Globe, LayoutGrid, LayoutTemplate, Lock, LockOpen, MessageSquare, Plus, Save, StickyNote, Terminal, Type, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { isCanvasView } from '@ruimte/contracts';
import { applyLayoutAction, createNodeAction, createTextAction, deleteLayoutAction, fitAction, setLocksAction } from '@/actions/client-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { LOCK_KEYS, lockHint, lockLabel } from '@/canvas/locks';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { StatusSummary } from '@/shell/StatusSummary';
import { ButtonGroup, Icon, IconButton, Menu, Separator, Kbd, DockShell, ZoomControls } from '@basmilius/desktop-ui';
import { useSettings } from '@/state/settings';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/*
 * The canvas's own controls: zoom, locks, layouts and the plus that adds a node. A view of its own
 * has no canvas under it, so the dock stays away there; its counters are the sidebar's "Needs you"
 * section, and the way out of a body is Escape, the shortcut a terminal uses, or its row in the list.
 */
export function Dock({ onHiddenChange }: { onHiddenChange?: (hidden: boolean) => void }) {
    const { t } = useTranslation(['shell', 'common']);
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    /* The canvas under this dock. It is drawn in the focused cell only, which is the canvas the
       actions behind adding a node and fitting are sent to. */
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
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    // A maximized node is all the canvas shows, so the controls for the rest of it step aside.
    const maximized = useCanvas((s) => maximizedNodeOf(s) !== null);
    const anyLocked = Object.values(locks).some(Boolean);
    const allLocked = Object.values(locks).every(Boolean);

    // The shell says so while it is mounted; gone, the stack of prompts above it has to hear it from here.
    useEffect(() => {
        if (maximized) {
            onHiddenChange?.(true);
        }
    }, [maximized, onHiddenChange]);

    if (!onCanvas || maximized) {
        return null;
    }
    return (
        <DockShell autoHide={dockAutoHide} onHiddenChange={onHiddenChange}>
            <StatusSummary />

            <Menu.Root>
                <IconButton icon={Plus} label={t('dock.add')} render={<Menu.Trigger />} />
                <Menu.Popup side="top" sideOffset={10} align="start">
                    <Menu.Item onClick={() => void createNodeAction('terminal')}>
                        <Icon icon={Terminal} size={14} /> {t('nodeKinds.terminal')} <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                    </Menu.Item>
                    <Menu.Item onClick={() => void createNodeAction('chat')}>
                        <Icon icon={MessageSquare} size={14} /> {t('nodeKinds.chat')} <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                    </Menu.Item>
                    <AgentSubmenus onPick={(target, provider) => void createNodeAction(target, { provider: provider.kind })} />
                    <Menu.Item onClick={() => void createNodeAction('browser')}>
                        <Icon icon={Globe} size={14} /> {t('nodeKinds.browser')} <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                    </Menu.Item>
                    <Menu.Item onClick={() => void createNodeAction('group')}>
                        <Icon icon={LayoutGrid} size={14} /> {t('nodeKinds.group')} <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
                    </Menu.Item>
                    <Menu.Item onClick={() => void createNodeAction('note')}>
                        <Icon icon={StickyNote} size={14} /> {t('nodeKinds.note')} <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item onClick={() => createTextAction()}>
                        <Icon icon={Type} size={14} /> {t('nodeKinds.text')} <Menu.Hint>{t('dock.doubleClick')}</Menu.Hint>
                    </Menu.Item>
                </Menu.Popup>
            </Menu.Root>

            <Separator />

            <ZoomControls
                zoom={zoom}
                shortcuts={CANVAS_SHORTCUTS}
                onZoomChange={(next) => canvasStore.getState().zoomTo(next)}
                onFitAll={() => fitAction()}
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
                    <ButtonGroup>
                        <TerminalDictationButton terminalId={terminalId} />
                    </ButtonGroup>
                    <Separator />
                </>
            )}

            <ButtonGroup>
                <Menu.Root>
                    <IconButton icon={anyLocked ? Lock : LockOpen} label={t('dock.lock')} active={anyLocked} render={<Menu.Trigger />} />
                    <Menu.Popup side="top" sideOffset={10} align="end">
                        <Menu.Label>{t('dock.refuseGestures')}</Menu.Label>
                        {LOCK_KEYS.map((key) => (
                            <Menu.CheckboxItem
                                key={key}
                                className="items-start"
                                checked={locks[key]}
                                onCheckedChange={() => setLocksAction(!locks[key], [key])}
                                closeOnClick={false}
                            >
                                <span>
                                    <span className="block">{lockLabel(key)}</span>
                                    <span className="block text-xs text-text-faint">{lockHint(key)}</span>
                                </span>
                            </Menu.CheckboxItem>
                        ))}
                        <Menu.Separator />
                        <Menu.Item onClick={() => setLocksAction(!allLocked)}>
                            {allLocked ? <Icon icon={LockOpen} size={14} /> : <Icon icon={Lock} size={14} />}
                            {allLocked ? t('dock.unlockEverything') : t('dock.lockEverything')}
                        </Menu.Item>
                        <div className="px-2.5 pb-1.5 pt-1 text-xs text-text-faint">{t('dock.lockHint')}</div>
                    </Menu.Popup>
                </Menu.Root>

                <Menu.Root>
                    <IconButton icon={LayoutTemplate} label={t('dock.layouts')} render={<Menu.Trigger />} />
                    <Menu.Popup side="top" sideOffset={10} align="end" className="min-w-48">
                        <Menu.Label>{t('dock.savedLayouts')}</Menu.Label>
                        {layouts.length === 0 && <div className="px-2.5 pb-1.5 text-xs text-text-faint">{t('dock.noLayouts')}</div>}
                        {layouts.map((layout) => (
                            <Menu.Item key={layout.name} className="group" onClick={() => applyLayoutAction(layout.name)}>
                                <Icon icon={LayoutTemplate} size={14} className="text-text-faint" />
                                <span className="truncate">{layout.name}</span>
                                <IconButton
                                    icon={X}
                                    size="2xs"
                                    label={t('common:action.delete')}
                                    className="ml-auto opacity-0 hover:bg-surface-active group-hover:opacity-100 group-data-[highlighted]:opacity-100"
                                    render={<span role="button" />}
                                    onClick={(e) => {
                                        // The row applies; only the corner deletes.
                                        e.stopPropagation();
                                        deleteLayoutAction(layout.name);
                                    }}
                                />
                            </Menu.Item>
                        ))}
                        <Menu.Separator />
                        <Menu.Item onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                            <Icon icon={Save} size={14} /> {t('dock.saveLayout')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
            </ButtonGroup>
        </DockShell>
    );
}
