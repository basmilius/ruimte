import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@ruimte/agents-react/chat/ui/Markdown';
import type { EditorRect } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { kindLetterOf, kindToneOf, type KindTone } from './completion-model';
import { Signature } from './HoverCard';
import { PathText } from './PathText';
import { placeBeside, placePopup } from './popup-placement';
import type { CompletionView } from './popups';

const TONES: Record<KindTone, string> = {
    callable: 'bg-accent-soft text-accent',
    value: 'bg-status-running/15 text-status-running',
    type: 'bg-status-idle/15 text-status-idle',
    other: 'bg-surface-hover text-text-muted'
};

/* The label with the characters that match what was typed set apart. */
function MarkedLabel({ label, matches }: { label: string; matches: readonly number[] }) {
    if (matches.length === 0) {
        return <>{label}</>;
    }
    const marked = new Set(matches);
    const runs: { text: string; marked: boolean }[] = [];
    for (let at = 0; at < label.length; at++) {
        const isMarked = marked.has(at);
        const last = runs[runs.length - 1];
        if (last !== undefined && last.marked === isMarked) {
            last.text += label[at];
        } else {
            runs.push({ text: label[at]!, marked: isMarked });
        }
    }
    return (
        <>
            {runs.map((run, index) =>
                run.marked ? (
                    <span key={index} className="font-semibold text-accent">
                        {run.text}
                    </span>
                ) : (
                    run.text
                )
            )}
        </>
    );
}

const CARD = 'fixed top-0 left-0 z-(--z-popup) overflow-hidden rounded-lg border border-border bg-surface-raised text-text shadow-(--float-shadow)';
const ROW_HEIGHT = 24;
const VISIBLE_ROWS = 8;
/* What a row takes besides its name and namespace: padding, the kind badge and the gaps. */
const ROW_CHROME = 72;

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
    // The widest row so far in characters, which only grows, so the list never narrows or jumps while it is typed into.
    const [widest, setWidest] = useState(0);
    const need = Math.max(0, ...view.rows.slice(0, VISIBLE_ROWS * 2).map((row) => row.label.length + 2 + row.description.length));
    if (need > widest) {
        setWidest(need);
    }

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
            <div
                ref={list}
                className={`${CARD} flex w-max max-w-[min(560px,calc(100vw-16px))] min-w-[340px] flex-col`}
                style={{ visibility: 'hidden' }}
                onPointerDown={(event) => event.preventDefault()}
            >
                {/* Sizes the list to the widest rows in the face the rows use; the rows themselves fill that width and truncate inside it. */}
                <div aria-hidden className="h-0 overflow-hidden font-mono text-code" style={{ width: `calc(${Math.max(widest, need)}ch + ${ROW_CHROME}px)` }} />
                <div role="listbox" className="w-0 min-w-full overflow-y-auto p-1" style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS + 8 }}>
                    {view.rows.map((row, index) => (
                        <button
                            key={`${index}:${row.label}`}
                            ref={index === view.active ? activeRow : undefined}
                            type="button"
                            role="option"
                            aria-selected={index === view.active}
                            data-active={index === view.active}
                            className="flex h-6 w-full items-center gap-2 overflow-hidden rounded-md px-1.5 text-left text-xs cursor-row"
                            onClick={() => void language.completion.accept(false, index)}
                        >
                            <span
                                className={`grid size-4 shrink-0 place-items-center rounded-sm font-mono text-xs leading-none font-semibold ${TONES[kindToneOf(row.kind)]}`}
                            >
                                {kindLetterOf(row.kind)}
                            </span>
                            <span className={`max-w-full shrink-0 truncate font-mono text-code ${row.deprecated ? 'line-through' : ''}`}>
                                <MarkedLabel label={row.label} matches={row.matches} />
                            </span>
                            <span className="min-w-0 grow truncate font-mono text-text-faint">{row.detail}</span>
                            <PathText path={row.description} className="max-w-[60%] font-mono text-text-faint" />
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
