import { DictationControl } from '@/dictation/DictationControl';
import { DictationError } from '@/dictation/engine';
import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { ClipboardPaste, Copy, Scan, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/chat/ui/Markdown';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText, readClipboardText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { EDIT_SHORTCUTS } from '@/ui/shortcut';
import { Kbd } from '@/ui/Kbd';

/*
 * A sticky note: rendered markdown on the canvas, a textarea while the node has focus. The text
 * is saved with the project and, linked into an agent, read by it as a text source.
 */
export function NoteNode({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const body = useCanvas((s) => s.nodes[id]?.body ?? '');
    const ref = useRef<HTMLTextAreaElement>(null);
    const dictationRoot = useRef<HTMLDivElement>(null);
    // What was selected in the field when its menu opened; a textarea keeps that to itself, so the
    // rows work on the value and put the caret back themselves.
    const [range, setRange] = useState<[number, number]>([0, 0]);

    useEffect(() => {
        if (focused && ref.current) {
            const el = ref.current;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, [focused]);

    if (focused) {
        const selected = body.slice(range[0], range[1]);
        const replaceSelection = (text: string): void => {
            canvasStore.getState().updateNode(id, { body: `${body.slice(0, range[0])}${text}${body.slice(range[1])}` });
            const caret = range[0] + text.length;
            // The value comes back through the store, so the caret goes back after that render.
            requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret));
        };
        const paste = async (): Promise<void> => {
            const text = await readClipboardText();
            if (text !== '') {
                replaceSelection(text);
            }
        };
        return (
            <ContextMenu.Root
                onOpenChange={(open) => {
                    const field = ref.current;
                    setRange(open && field ? [field.selectionStart, field.selectionEnd] : [0, 0]);
                }}
            >
                <ContextMenu.Trigger className="h-full w-full">
                    <div ref={dictationRoot} className="flex h-full min-h-0 flex-col">
                        <textarea
                            ref={ref}
                            value={body}
                            placeholder={t('note.placeholder')}
                            spellCheck={false}
                            className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2.5 font-sans text-sm leading-normal text-text outline-none placeholder:text-text-faint"
                            onChange={(e) => canvasStore.getState().updateNode(id, { body: e.target.value })}
                        />
                        <DictationControl
                            targetRef={dictationRoot}
                            capture={() => {
                                const field = ref.current;
                                if (!field) {
                                    return null;
                                }
                                const before = field.value;
                                const from = field.selectionStart;
                                const to = field.selectionEnd;
                                return {
                                    insert: (text) => {
                                        if (ref.current !== field || field.value !== before) {
                                            throw new DictationError('targetChanged');
                                        }
                                        canvasStore.getState().updateNode(id, { body: `${before.slice(0, from)}${text}${before.slice(to)}` }, true);
                                        requestAnimationFrame(() => {
                                            if (ref.current === field) {
                                                field.setSelectionRange(from + text.length, from + text.length);
                                            }
                                        });
                                    }
                                };
                            }}
                        />
                    </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-(--z-popup)">
                        <ContextMenu.Popup className="menu-popup">
                            <ContextMenu.Item className="menu-item" disabled={selected === ''} onClick={() => copyText(selected)}>
                                <Icon icon={Copy} size={14} /> {t('common:action.copy')} <Kbd shortcut={EDIT_SHORTCUTS.copy} />
                            </ContextMenu.Item>
                            <ContextMenu.Item
                                className="menu-item"
                                disabled={selected === ''}
                                onClick={() => {
                                    copyText(selected);
                                    replaceSelection('');
                                }}
                            >
                                <Icon icon={Scissors} size={14} /> {t('edit.cut')} <Kbd shortcut={EDIT_SHORTCUTS.cut} />
                            </ContextMenu.Item>
                            <ContextMenu.Item className="menu-item" onClick={() => void paste()}>
                                <Icon icon={ClipboardPaste} size={14} /> {t('edit.paste')} <Kbd shortcut={EDIT_SHORTCUTS.paste} />
                            </ContextMenu.Item>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item className="menu-item" onClick={() => ref.current?.select()}>
                                <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={EDIT_SHORTCUTS.selectAll} />
                            </ContextMenu.Item>
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            </ContextMenu.Root>
        );
    }

    if (body.trim() === '') {
        // An empty note has nothing to read, so the first click may as well put the cursor in it.
        return (
            <button
                className="h-full w-full cursor-text px-3 py-2.5 text-left text-sm text-text-faint"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => canvasStore.getState().activateNode(id)}
            >
                {t('note.empty')}
            </button>
        );
    }

    return <div className="h-full overflow-auto px-3 py-2.5 select-text">{<Markdown text={body} breaks />}</div>;
}
