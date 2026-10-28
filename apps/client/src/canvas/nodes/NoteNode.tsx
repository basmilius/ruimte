import { DictationControl } from '@/dictation/DictationControl';
import { DictationError } from '@/dictation/engine';
import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Copy, Lock, Pencil, Scan, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@adecore/agents-react/chat/ui';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { setNotePreviewLocked, useNotePreviewLocked } from '@/state/note-previews';
import { copyText, readClipboardText, Icon, IconButton, EDIT_SHORTCUTS, Kbd, ContextMenu } from '@adecore/ui';

/* The note while it has the focus: a textarea with its own menu, since a textarea keeps its selection to itself. */
function NoteEditor({ id, body }: { id: string; body: string }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const ref = useRef<HTMLTextAreaElement>(null);
    const dictationRoot = useRef<HTMLDivElement>(null);
    // What was selected when the menu opened, so its rows work on the value and put the caret back themselves.
    const [range, setRange] = useState<[number, number]>([0, 0]);

    useEffect(() => {
        const el = ref.current;
        if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, []);

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
            <ContextMenu.Popup>
                <ContextMenu.Item disabled={selected === ''} onClick={() => copyText(selected)}>
                    <Icon icon={Copy} size={14} /> {t('common:action.copy')} <Kbd shortcut={EDIT_SHORTCUTS.copy} />
                </ContextMenu.Item>
                <ContextMenu.Item
                    disabled={selected === ''}
                    onClick={() => {
                        copyText(selected);
                        replaceSelection('');
                    }}
                >
                    <Icon icon={Scissors} size={14} /> {t('edit.cut')} <Kbd shortcut={EDIT_SHORTCUTS.cut} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => void paste()}>
                    <Icon icon={ClipboardPaste} size={14} /> {t('edit.paste')} <Kbd shortcut={EDIT_SHORTCUTS.paste} />
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => ref.current?.select()}>
                    <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={EDIT_SHORTCUTS.selectAll} />
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* The switch in a note's header between reading and writing. An empty note has nothing to read, so it has none. */
export function NotePreviewLock({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const hasText = useCanvas((s) => (s.nodes[id]?.body ?? '').trim() !== '');
    const locked = useNotePreviewLocked(id);

    if (!hasText) {
        return null;
    }

    return (
        <IconButton
            icon={locked ? Pencil : Lock}
            size="sm"
            label={locked ? t('note.unlockPreview') : t('note.lockPreview')}
            onClick={() => {
                setNotePreviewLocked(id, !locked);

                // Unlocking is for writing, so the editor takes the keyboard at once.
                if (locked) {
                    canvasStore.getState().activateNode(id);
                }
            }}
        />
    );
}

/*
 * A sticky note: rendered markdown on the canvas, a textarea while the node has focus. The text
 * is saved with the project and, linked into an agent, read by it as a text source. A note a person
 * locked to its preview stays rendered with the focus too, so it scrolls and maximizes to be read.
 */
export function NoteNode({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const body = useCanvas((s) => s.nodes[id]?.body ?? '');
    const locked = useNotePreviewLocked(id);

    // An empty note has nothing to preview, so a lock left on one never keeps a person from writing in it.
    if (focused && (!locked || body.trim() === '')) {
        return <NoteEditor id={id} body={body} />;
    }

    if (body.trim() === '') {
        // An empty note has nothing to read, so the first click may as well put the cursor in it.
        return (
            <button
                className="flex h-full w-full cursor-text items-start px-3 py-2.5 text-left text-sm leading-normal text-text-faint"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => canvasStore.getState().activateNode(id)}
            >
                {t('note.empty')}
            </button>
        );
    }

    return (
        <div className="note-markdown h-full overflow-auto px-3 py-2.5 select-text">
            <Markdown text={body} breaks />
        </div>
    );
}
