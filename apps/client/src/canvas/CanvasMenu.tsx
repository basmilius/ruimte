import { Icon, Kbd, ContextMenu } from '@adecore/ui';
import { Maximize, Minus, Scan, SquareDashedMousePointer, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createNodeAction, createTextAction, fitAction, groupSelectionAction, selectAllAction } from '@/action-port/person-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import type { Point } from '@/canvas-model/math';
import { RemoteMachineItems } from '@/canvas/RemoteMachineItems';
import { DesignAddItem } from '@/design/DesignAddItem';
import { ExtensionNodesSubmenu, SlotMenuItems } from '@/extensions/SlotSurfaces';
import { RoutineAddItems } from '@/routines/RoutineAddItems';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { NODE_KIND_ICONS } from '@/surface/canvas/node-icons';
import { ADD_NODE_ROWS, CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { RowKbd } from '@/surface/RowKbd';

function AddItem({ kind, at }: { kind: keyof typeof ADD_NODE_ROWS; at: () => Point }) {
    const { t } = useTranslation('canvas');
    return (
        <ContextMenu.Item onClick={() => void createNodeAction(kind, { at: at() })}>
            <Icon icon={NODE_KIND_ICONS[kind]} size={14} /> {t(`kinds.${kind}`)} <RowKbd row={ADD_NODE_ROWS[kind]} />
        </ContextMenu.Item>
    );
}

/* Nodes and text land at the right-click; a line starts with the next drag. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const hasSelection = useCanvas((s) => s.selection.length > 0);

    return (
        <ContextMenu.Popup>
            <CanvasCreateItems at={at} />
            <ExtensionNodesSubmenu at={at()} />
            <ContextMenu.Separator />
            <ContextMenu.Group>
                <ContextMenu.Item onClick={() => selectAllAction(canvasStore)}>
                    <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
                </ContextMenu.Item>
                <ContextMenu.Item disabled={!hasSelection} onClick={() => groupSelectionAction()}>
                    <Icon icon={SquareDashedMousePointer} size={14} /> {t('canvasMenu.groupSelection')} <RowKbd row="group-selection" />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => fitAction()}>
                    <Icon icon={Maximize} size={14} /> {t('canvasMenu.zoomToFit')} <RowKbd row="fit" />
                </ContextMenu.Item>
            </ContextMenu.Group>
            <SlotMenuItems place="canvasMenu" context={{ at: at() }} />
        </ContextMenu.Popup>
    );
}

/* What a right-click can add at its point: on the empty canvas, and inside a group under New node. */
export function CanvasCreateItems({ at }: { at: () => Point }) {
    const { t } = useTranslation(['canvas', 'drawing']);
    const canvasStore = useCanvasStore();
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);

    return (
        <>
            <ContextMenu.Group>
                <AgentSubmenus onPick={(target, provider, account) => void createNodeAction(target, { provider: provider.kind, account, at: at() })} />
                {(['terminal', 'chat', 'browser'] as const).map((kind) => (
                    <AddItem key={kind} kind={kind} at={at} />
                ))}
                <RoutineAddItems at={at} />
                <DesignAddItem at={at} />
                <AddItem kind="group" at={at} />
                {hasFolder && (
                    <ContextMenu.Item onClick={() => useUi.getState().openFilePicker({ kind: 'node', at: at() })}>
                        <Icon icon={NODE_KIND_ICONS.file} size={14} /> {t('canvasMenu.file')}
                    </ContextMenu.Item>
                )}
                <RemoteMachineItems at={at} />
            </ContextMenu.Group>
            <ContextMenu.Separator />
            <ContextMenu.Group>
                <AddItem kind="note" at={at} />
                <ContextMenu.Item onClick={() => canvasStore.getState().setLineTool('line')}>
                    <Icon icon={Minus} size={14} /> {t('drawing:tools.line')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => createTextAction(at())}>
                    <Icon icon={Type} size={14} /> {t('kinds.text')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
                </ContextMenu.Item>
            </ContextMenu.Group>
        </>
    );
}
