import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { ClipboardPaste, Copy, Scan, Scissors } from 'lucide-react';
import { Markdown } from '@/chat/ui/Markdown';
import { useCanvas } from '@/state/canvas';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText, readClipboardText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

/*
 * A sticky note: rendered markdown on the canvas, a textarea while the node has focus. The text
 * is saved with the project and, linked into an agent, read by it as a text source.
 */
export function NoteNode({ id, focused }: { id: string; focused: boolean }) {
    const body = useCanvas((s) => s.nodes[id]?.body ?? '');
    const ref = useRef<HTMLTextAreaElement>(null);
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
            useCanvas.getState().updateNode(id, { body: `${body.slice(0, range[0])}${text}${body.slice(range[1])}` });
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
                    <textarea
                        ref={ref}
                        value={body}
                        placeholder="Write a note. Markdown works."
                        spellCheck={false}
                        className="h-full w-full resize-none bg-transparent px-3 py-2.5 font-sans text-sm leading-normal text-text outline-none placeholder:text-text-faint"
                        onChange={(e) => useCanvas.getState().updateNode(id, { body: e.target.value })}
                    />
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-[var(--z-popup)]">
                        <ContextMenu.Popup className="menu-popup">
                            <ContextMenu.Item className="menu-item" disabled={selected === ''} onClick={() => copyText(selected)}>
                                <Icon icon={Copy} size={14} /> Copy <kbd>⌘C</kbd>
                            </ContextMenu.Item>
                            <ContextMenu.Item
                                className="menu-item"
                                disabled={selected === ''}
                                onClick={() => {
                                    copyText(selected);
                                    replaceSelection('');
                                }}
                            >
                                <Icon icon={Scissors} size={14} /> Cut <kbd>⌘X</kbd>
                            </ContextMenu.Item>
                            <ContextMenu.Item className="menu-item" onClick={() => void paste()}>
                                <Icon icon={ClipboardPaste} size={14} /> Paste <kbd>⌘V</kbd>
                            </ContextMenu.Item>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item className="menu-item" onClick={() => ref.current?.select()}>
                                <Icon icon={Scan} size={14} /> Select all <kbd>⌘A</kbd>
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
                onClick={() => useCanvas.getState().enterNode(id)}
            >
                Click to write
            </button>
        );
    }

    // No menu here: the frame lays an overlay over an unfocused body, so there is nothing to select
    // and nothing to copy until the note is entered, which is where its own menu lives.
    return <div className="h-full overflow-auto px-3 py-2.5 select-text">{<Markdown text={body} />}</div>;
}
