import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@ruimte/agents-react/chat/ui/Markdown';
import type { EditorRect } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { kindLetterOf, kindToneOf, type KindTone } from './completion-model';
import { Signature } from './HoverCard';
import { placeBeside, placePopup } from './popup-placement';
import type { CompletionView } from './popups';

const TONES: Record<KindTone, string> = {
    callable: 'bg-accent-soft text-accent',
    value: 'bg-status-running/15 text-status-running',
    type: 'bg-status-idle/15 text-status-idle',
    other: 'bg-surface-hover text-text-muted'
};

const CARD = 'fixed top-0 left-0 z-(--z-popup) overflow-hidden rounded-lg border border-border bg-surface-raised text-text shadow-(--float-shadow)';
const ROW_HEIGHT = 24;
const VISIBLE_ROWS = 8;

/*
 * The suggestions under the word being typed: a narrow list with the parameters of each, and the
 * documentation of the active one beside it, or under it when the window has no room at its side. A
 * press on a row never takes the focus from the editor, so typing goes on while the list is open.
 */
export function CompletionPopup({ language, view, rect }: { language: EditorLanguage; view: CompletionView; rect: EditorRect }) {
    const { t } = useTranslation('panels');
    const list = useRef<HTMLDivElement>(null);
    const docs = useRef<HTMLDivElement>(null);
    const activeRow = useRef<HTMLButtonElement>(null);

    // Every render: the word moves when the editor scrolls, and the list and the documentation change size with what they hold.
    useLayoutEffect(() => {
        const card = list.current;
        if (card === null) {
            return;
        }
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const placed = placePopup(rect, { width: card.offsetWidth, height: card.offsetHeight }, viewport, { gap: 2 });
        card.style.left = `${Math.round(placed.left)}px`;
        card.style.top = `${Math.round(placed.top)}px`;
        card.style.visibility = 'visible';
        const side = docs.current;
        if (side !== null) {
            const box = { left: Math.round(placed.left), top: Math.round(placed.top), width: card.offsetWidth, height: card.offsetHeight };
            const beside = placeBeside(box, { width: side.offsetWidth, height: side.offsetHeight }, viewport);
            side.style.left = `${Math.round(beside.left)}px`;
            side.style.top = `${Math.round(beside.top)}px`;
            side.style.maxHeight = `${Math.floor(beside.maxHeight)}px`;
            side.style.visibility = 'visible';
        }
    });

    useLayoutEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [view.active, view.rows]);

    return createPortal(
        <>
            <div ref={list} className={`${CARD} flex w-[340px] flex-col`} style={{ visibility: 'hidden' }} onPointerDown={(event) => event.preventDefault()}>
                <div role="listbox" className="overflow-y-auto p-1" style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS + 8 }}>
                    {view.rows.map((row, index) => (
                        <button
                            key={`${index}:${row.label}`}
                            ref={index === view.active ? activeRow : undefined}
                            type="button"
                            role="option"
                            aria-selected={index === view.active}
                            data-active={index === view.active}
                            className="flex h-6 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs cursor-row"
                            onClick={() => void language.completion.accept(false, index)}
                        >
                            <span
                                className={`grid size-4 shrink-0 place-items-center rounded-sm font-mono text-xs font-semibold ${TONES[kindToneOf(row.kind)]}`}
                            >
                                {kindLetterOf(row.kind)}
                            </span>
                            <span className={`shrink-0 font-mono text-code ${row.deprecated ? 'line-through' : ''}`}>{row.label}</span>
                            <span className="ml-auto min-w-0 truncate font-mono text-text-faint">{row.detail}</span>
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-3 border-t border-border px-2 py-1 text-xs whitespace-nowrap text-text-faint">
                    <span>↵ {t('language.completion.insert')}</span>
                    <span>⇥ {t('language.completion.replace')}</span>
                    <span>^Space {t('language.completion.details')}</span>
                    <span className="ml-auto">{view.server}</span>
                </div>
            </div>
            {view.detailsOpen && view.docs !== null && (
                <div
                    ref={docs}
                    className={`${CARD} flex w-[320px] flex-col gap-2 overflow-y-auto p-3 select-text`}
                    style={{ visibility: 'hidden' }}
                    onPointerDown={(event) => event.preventDefault()}
                >
                    {view.docs.signature !== '' && <Signature code={view.docs.signature} language={view.highlightLanguage} />}
                    {view.docs.markdown !== '' && (
                        <div className="text-text-muted [&_.chat-markdown]:text-xs">
                            <Markdown text={view.docs.markdown} fileLinks={false} />
                        </div>
                    )}
                </div>
            )}
        </>,
        document.body
    );
}
