import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { FileTree } from '@pierre/trees';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { FileIcon, Icon } from '@adecore/ui';
import type { NewEntryKind } from '@/shell/panels/file-create';

const ICON_SIZE = 16;
const CHEVRON_SIZE = 12;

/* How much room the message under the row needs, past which it opens above the row instead. */
const MESSAGE_ROOM = 48;

/* The drawn row the tree holds open for the entry, which is not there while it scrolls out of view. */
function openRowOf(model: FileTree, path: string): HTMLElement | null {
    const rows = model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]:not([data-item-parked="true"]):not([data-file-tree-sticky-row])');
    return [...(rows ?? [])].find((row) => row.dataset.itemPath === path) ?? null;
}

interface NewEntryRowProps {
    model: FileTree;
    /* The tree path of the row held open, which this row is drawn over. */
    placeholder: string;
    kind: NewEntryKind;
    value: string;
    /* Why the name is refused, shown under the row. */
    message: string | null;
    busy: boolean;
    label: string;
    onChange(value: string): void;
    onSubmit(): void;
    onCancel(): void;
    onBlur(): void;
}

/*
 * The row a name is typed in. The tree draws rows inside a shadow root and has no row of this kind,
 * so it holds an empty one open at the place the entry will appear and this is drawn over it, in
 * the same frame: `FileIcon` follows the name as it is typed, which the tree's own rename input
 * cannot do. It must sit inside an element that clips and is positioned.
 */
export function NewEntryRow({ model, placeholder, kind, value, message, busy, label, onChange, onSubmit, onCancel, onBlur }: NewEntryRowProps) {
    const box = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        input.current?.focus();
    }, []);

    /* The tree scrolls and re-renders on its own, so the row follows by measuring each frame. */
    useEffect(() => {
        let frame = 0;
        let scrolled = false;
        const place = (): void => {
            frame = requestAnimationFrame(place);
            const element = box.current;
            const frameRect = element?.offsetParent?.getBoundingClientRect();
            const row = openRowOf(model, placeholder);
            if (element === null || frameRect === undefined) {
                return;
            }
            if (row === null) {
                element.toggleAttribute('data-placed', false);
                if (!scrolled && model.getItem(placeholder) !== null) {
                    scrolled = true;
                    model.scrollToPath(placeholder, { offset: 'nearest' });
                }
                return;
            }
            const rowRect = row.getBoundingClientRect();
            const icon = row.querySelector(':scope > [data-item-section="icon"]')?.getBoundingClientRect();
            const content = row.querySelector(':scope > [data-item-section="content"]')?.getBoundingClientRect();
            if (icon === undefined || content === undefined) {
                return;
            }
            const style = element.style;
            style.top = `${Math.round(rowRect.top - frameRect.top)}px`;
            style.height = `${Math.round(rowRect.height)}px`;
            style.setProperty('--icon-x', `${Math.round(icon.left - frameRect.left + (icon.width - (kind === 'file' ? ICON_SIZE : CHEVRON_SIZE)) / 2)}px`);
            style.setProperty('--name-x', `${Math.round(content.left - frameRect.left)}px`);
            element.toggleAttribute('data-flip', rowRect.bottom - frameRect.top + MESSAGE_ROOM > frameRect.height);
            element.toggleAttribute('data-placed', true);
        };
        place();
        return () => cancelAnimationFrame(frame);
    }, [model, placeholder, kind]);

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
        }
    };

    return (
        <div
            ref={box}
            className="group pointer-events-none absolute right-0 left-0 z-10 flex items-center bg-surface-hover opacity-0 data-placed:pointer-events-auto data-placed:opacity-100"
        >
            <span className="absolute flex items-center" style={{ left: 'var(--icon-x)' }}>
                {kind === 'file' ? (
                    <FileIcon path={value.trim()} size={ICON_SIZE} />
                ) : (
                    <Icon icon={ChevronRight} size={CHEVRON_SIZE} className="text-text-muted" />
                )}
            </span>
            <input
                ref={input}
                value={value}
                disabled={busy}
                spellCheck={false}
                autoComplete="off"
                aria-label={label}
                aria-invalid={message !== null}
                className={clsx(
                    'absolute right-2 h-5 min-w-0 rounded-sm border bg-surface px-1 text-xs text-text outline-none',
                    message === null ? 'border-accent' : 'border-status-error'
                )}
                style={{ left: 'var(--name-x)' }}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
            />
            {message !== null && (
                <div
                    role="alert"
                    className="absolute top-full right-2 mt-1 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-status-error group-data-flip:top-auto group-data-flip:bottom-full group-data-flip:mt-0 group-data-flip:mb-1"
                    style={{ left: 'var(--name-x)' }}
                >
                    {message}
                </div>
            )}
        </div>
    );
}
