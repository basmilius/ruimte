import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EditorRect } from '@adecore/editor';
import type { EditorLanguage } from './editor-language';
import { PathText } from './PathText';
import { placePopup } from './popup-placement';
import type { PickPreview, PickView } from './popups';

const CARD =
    'fixed top-0 left-0 z-(--z-popup) flex w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-text shadow-(--float-shadow)';

function PreviewLines({ preview }: { preview: PickPreview }) {
    return (
        <div className="flex flex-col gap-px border-t border-border p-1 font-mono text-code">
            {preview.removed.map((line, index) => (
                <div key={`-${index}`} className="flex gap-2 rounded-sm bg-status-error/10 px-1.5 whitespace-pre">
                    <span className="text-status-error">−</span>
                    <span className="min-w-0 truncate">{line}</span>
                </div>
            ))}
            {preview.added.map((line, index) => (
                <div key={`+${index}`} className="flex gap-2 rounded-sm bg-status-idle/10 px-1.5 whitespace-pre">
                    <span className="text-status-idle">+</span>
                    <span className="min-w-0 truncate">{line}</span>
                </div>
            ))}
            {preview.note !== null && <div className="px-1.5 font-sans text-xs text-text-muted">{preview.note}</div>}
            {preview.refusal !== undefined && (
                <div role="alert" className="px-1.5 py-0.5 font-sans text-xs text-status-error">
                    {preview.refusal}
                </div>
            )}
        </div>
    );
}

/*
 * The list of an editor's pick feature under the character it belongs to. A press on a row never takes
 * the focus from the editor, so the keys keep going to it while the list is open.
 */
export function PickPopup({ language, view, rect }: { language: EditorLanguage; view: PickView; rect: EditorRect }) {
    const card = useRef<HTMLDivElement>(null);
    const activeRow = useRef<HTMLButtonElement>(null);

    // Every render: the character moves with the scroll, and the list changes size with its preview.
    useLayoutEffect(() => {
        const element = card.current;
        if (element === null) {
            return;
        }
        const placed = placePopup(
            rect,
            { width: element.offsetWidth, height: element.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
            { gap: 2 }
        );
        element.style.left = `${Math.round(placed.left)}px`;
        element.style.top = `${Math.round(placed.top)}px`;
        element.style.maxHeight = `${Math.floor(placed.maxHeight)}px`;
        element.style.visibility = 'visible';
    });

    useLayoutEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [view.active]);

    return createPortal(
        <div ref={card} className={CARD} style={{ visibility: 'hidden' }} onPointerDown={(event) => event.preventDefault()}>
            {view.title !== null && <div className="border-b border-border px-3 py-1.5 text-xs text-text-muted">{view.title}</div>}
            <div role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
                {view.groups.map((group, groupIndex) => (
                    <div key={group.title ?? groupIndex} role="group" className="flex flex-col">
                        {group.title !== null && <div className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-text-faint">{group.title}</div>}
                        {group.rows.map((row) => (
                            <button
                                key={row.id}
                                ref={row.id === view.active ? activeRow : undefined}
                                type="button"
                                role="option"
                                aria-selected={row.id === view.active}
                                data-active={row.id === view.active}
                                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs cursor-row"
                                onClick={() => language.pick.choose(row.id)}
                            >
                                <span className={row.path ? 'shrink-0' : 'min-w-0 truncate'}>{row.label}</span>
                                {row.path ? (
                                    <PathText path={row.detail} className="ml-auto font-mono text-text-faint" />
                                ) : (
                                    <span className="ml-auto shrink-0 font-mono text-text-faint">
                                        {row.id === view.active && row.detail === '' ? '↵' : row.detail}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
            {view.preview !== null && <PreviewLines preview={view.preview} />}
        </div>,
        document.body
    );
}
