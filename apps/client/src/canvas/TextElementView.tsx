import { memo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, Pencil, Trash } from 'lucide-react';
import { deleteNodesAction } from '@/actions/client-actions';
import { accentColor } from '@/canvas/accents';
import { FONT_STACK } from '@/canvas/text-font';
import { loadDrawingFont } from '@/drawing/fonts';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { MENU_HINT, MENU_SEPARATOR } from '@ruimte/ui/classes';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';

export const TextElementView = memo(function TextElementView({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const text = useCanvas((s) => s.texts[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    const editing = useCanvas((s) => s.editingTextId === id);
    const resizeLocked = useCanvas((s) => s.locks.resize);
    const zoom = useCanvas((s) => s.camera.zoom);
    const hidden = useCanvas((s) => s.hidden.has(id));
    const ref = useRef<HTMLDivElement>(null);
    const hand = text?.font === 'hand';

    /* Kalam is not in the bundle's first load; a label set in it asks for the face the drawings use. */
    useEffect(() => {
        if (hand) {
            void loadDrawingFont();
        }
    }, [hand]);

    useEffect(() => {
        if (editing && ref.current) {
            ref.current.focus();
            const range = document.createRange();
            range.selectNodeContents(ref.current);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
        }
    }, [editing]);

    if (!text || hidden) {
        return null;
    }

    const commit = (): void => {
        const value = ref.current?.innerText.trim() ?? '';
        canvasStore.getState().updateText(id, value);
        canvasStore.getState().setEditingText(null);
        if (value === '') {
            canvasStore.getState().select([id]);
            canvasStore.getState().deleteSelected();
        }
    };

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                ref={ref}
                data-text-id={id}
                data-placeholder={t('text.placeholder')}
                className={clsx(
                    'text-element absolute rounded-sm px-1 py-0.5 leading-tight text-text',
                    text.bold ? 'font-bold' : 'font-medium',
                    text.italic && 'italic',
                    selected && !editing && 'outline-2 outline-accent',
                    !editing && 'cursor-default'
                )}
                style={{
                    left: text.x,
                    top: text.y,
                    fontSize: text.size,
                    color: accentColor(text.color),
                    fontFamily: FONT_STACK[text.font ?? 'sans'],
                    width: text.maxWidth,
                    maxWidth: text.maxWidth,
                    whiteSpace: text.maxWidth ? 'pre-wrap' : 'pre',
                    overflowWrap: 'anywhere',
                    textAlign: text.align ?? 'left',
                    textDecorationLine: [text.underline && 'underline', text.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none'
                }}
                contentEditable={editing ? 'plaintext-only' : false}
                suppressContentEditableWarning
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    canvasStore.getState().setEditingText(id);
                }}
                onBlur={editing ? commit : undefined}
                onKeyDown={(e) => {
                    if (editing && (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey))) {
                        e.preventDefault();
                        ref.current?.blur();
                    }
                    if (editing) {
                        e.stopPropagation();
                    }
                }}
            >
                {text.text}
                {!editing &&
                    !resizeLocked &&
                    (['left', 'right'] as const).map((side) => (
                        <span
                            key={side}
                            data-text-resize={side}
                            contentEditable={false}
                            className="absolute inset-y-0 cursor-ew-resize"
                            style={{ [side]: -4 / zoom, width: 8 / zoom }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                canvasStore.getState().styleText(id, { maxWidth: undefined });
                            }}
                        />
                    ))}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item" disabled={editing} onClick={() => canvasStore.getState().setEditingText(id)}>
                            <Icon icon={Pencil} size={14} /> {t('common:action.edit')} <span className={MENU_HINT}>{t('menu.doubleClick')}</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item" disabled={text.text === ''} onClick={() => copyText(text.text)}>
                            <Icon icon={Copy} size={14} /> {t('text.copy')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                        <ContextMenu.Item className="menu-item" onClick={() => deleteNodesAction(canvasStore, [id])}>
                            <Icon icon={Trash} size={14} /> {t('common:action.delete')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
});
