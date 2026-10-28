import { useTranslation } from 'react-i18next';
import { Maximize, Minus, Scan, SquareDashedMousePointer, Type } from 'lucide-react';
import { createNodeAction, createTextAction, fitAction, groupSelectionAction, selectAllAction } from '@/actions/client-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { DesignAddItem } from '@/design/DesignAddItem';
import type { Point } from '@/canvas/math';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { RemoteMachineItems } from '@/canvas/RemoteMachineItems';
import { RoutineAddItems } from '@/routines/RoutineAddItems';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { Icon, Kbd, ContextMenu } from '@adecore/ui';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

function AddItem({ kind, at }: { kind: keyof typeof ADD_NODE_SHORTCUTS; at: () => Point }) {
    const { t } = useTranslation('canvas');
    return (
        <ContextMenu.Item onClick={() => void createNodeAction(kind, { at: at() })}>
            <Icon icon={NODE_KIND_ICONS[kind]} size={14} /> {t(`kinds.${kind}`)} <Kbd shortcut={ADD_NODE_SHORTCUTS[kind]} />
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
            <ContextMenu.Separator />
            <ContextMenu.Group>
                <ContextMenu.Item onClick={() => selectAllAction(canvasStore)}>
                    <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
                </ContextMenu.Item>
                <ContextMenu.Item disabled={!hasSelection} onClick={() => groupSelectionAction()}>
                    <Icon icon={SquareDashedMousePointer} size={14} /> {t('canvasMenu.groupSelection')} <Kbd shortcut={CANVAS_SHORTCUTS.group} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => fitAction()}>
                    <Icon icon={Maximize} size={14} /> {t('canvasMenu.zoomToFit')} <Kbd shortcut={CANVAS_SHORTCUTS.fitAll} />
                </ContextMenu.Item>
            </ContextMenu.Group>
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
