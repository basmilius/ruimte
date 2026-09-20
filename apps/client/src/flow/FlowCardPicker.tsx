import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { Search } from 'lucide-react';
import { FLOW_BUILT_IN_KINDS, FLOW_CARDS, type FlowCard, type FlowCardKind, type FlowContent } from '@ruimte/contracts';
import { groupCards, searchCards, type FlowCardRow } from '@/flow/card-search';
import { cardGlyph } from '@/flow/glyphs';
import { cardLabel, cardSentence, cardSource } from '@/flow/labels';
import { labelCollator } from '@/format/locale';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

export interface FlowCardChoice {
    kind: FlowCardKind;
    /* The catalog id, absent for a built-in card. */
    card?: string;
}

export interface FlowCardPickerProps {
    /* The kinds a choice may have. A line pulled out of a port only offers what may follow it. */
    kinds: readonly FlowCardKind[];
    /* The card being replaced, so the picker opens on what stands there now. */
    current?: FlowCardChoice;
    onPick(choice: FlowCardChoice): void;
    onClose(): void;
}

/* A card that is not on a worksheet yet reads its sentence against nothing, so its values read as placeholders. */
const NOTHING: FlowContent = { cards: {}, links: [] };

/* The words of one card, read once so the search never touches i18next per keystroke. */
const rowOf = (t: TFunction, kind: FlowCardKind, card?: string): FlowCardRow => {
    const sample: FlowCard = { kind, card, args: {}, x: 0, y: 0 };
    return {
        kind,
        card,
        label: cardLabel(t, sample),
        source: cardSource(t, sample),
        sentence: cardSentence(t, NOTHING, sample)
            .map((part) => part.text)
            .join('')
    };
};

/*
 * The list every card is added from. Base UI's `Dialog` rather than `PromptDialog`, because that one
 * is built around a typed answer and a confirm button while this question is answered by the row you
 * land on, so a picker on it would spend its size switching all of that off.
 */
export function FlowCardPicker({ kinds, current, onPick, onClose }: FlowCardPickerProps) {
    const { t } = useTranslation('flow');
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const ids = useId();
    const [query, setQuery] = useState('');

    const rows = useMemo(() => {
        const offered = new Set(kinds);
        const made = FLOW_CARDS.filter((definition) => offered.has(definition.kind)).map((definition) => rowOf(t, definition.kind, definition.id));
        return [...made, ...FLOW_BUILT_IN_KINDS.filter((kind) => offered.has(kind)).map((kind) => rowOf(t, kind))];
    }, [kinds, t]);
    const groups = useMemo(() => groupCards(searchCards(rows, query), t('kinds.builtIn'), labelCollator()), [rows, query, t]);
    const flat = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

    /* The row the keys act on. It starts on the card being replaced, which is what a person aims at
       when they open the picker on one, and the initializer reads the unfiltered list of this render. */
    const [index, setIndex] = useState(() => {
        const at = flat.findIndex((row) => row.kind === current?.kind && row.card === current?.card);
        return at < 0 ? 0 : at;
    });
    const activeAt = flat.length === 0 ? -1 : Math.min(index, flat.length - 1);
    const active = flat[activeAt];

    /* The arrows move a highlight, not the scroll: without this the list stays where it is and the
       row that is on walks off the bottom of it. `nearest` keeps a click from jumping the list. */
    useEffect(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    });

    const optionId = (at: number): string => `${ids}-option-${at}`;

    const pick = (row: FlowCardRow | undefined): void => {
        if (row === undefined) {
            return;
        }
        onPick(row.card === undefined ? { kind: row.kind } : { kind: row.kind, card: row.card });
    };

    return (
        <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                {/* Not in the middle: the list grows and shrinks with every keystroke, and a centered
                    one would walk up the screen while you type. */}
                <Dialog.Popup className="dialog-popup top-[18vh] w-[520px] [translate:-50%_0]" initialFocus={inputRef}>
                    <Dialog.Title className="sr-only">{t('picker.title')}</Dialog.Title>
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded
                            aria-controls={`${ids}-list`}
                            aria-autocomplete="list"
                            aria-activedescendant={active === undefined ? undefined : optionId(activeAt)}
                            aria-label={t('picker.search')}
                            aria-describedby={`${ids}-hint`}
                            className="h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                            placeholder={t('picker.search')}
                            value={query}
                            spellCheck={false}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setIndex(0);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setIndex((at) => (flat.length === 0 ? 0 : (Math.max(at, 0) + 1) % flat.length));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setIndex((at) => (flat.length === 0 ? 0 : (Math.max(at, 0) - 1 + flat.length) % flat.length));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    pick(active);
                                }
                            }}
                        />
                    </div>
                    <p id={`${ids}-hint`} className="sr-only">
                        {t('picker.searchHint')}
                    </p>
                    <div ref={listRef} id={`${ids}-list`} className="max-h-[50vh] overflow-auto p-1.5" role="listbox" aria-label={t('picker.results')}>
                        {flat.length === 0 && <div className="px-3 py-6 text-center text-xs text-text-faint">{t('picker.noMatch')}</div>}
                        {groups.map((group) => (
                            <div key={group.heading} role="group" aria-label={group.heading}>
                                <div className={`${SECTION_LABEL} px-2.5 pt-1.5 pb-1`}>{group.heading}</div>
                                {group.rows.map((row) => {
                                    const at = flat.indexOf(row);
                                    return (
                                        <button
                                            key={`${row.kind}:${row.card ?? ''}`}
                                            id={optionId(at)}
                                            role="option"
                                            aria-selected={at === activeAt}
                                            data-active={at === activeAt}
                                            className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted"
                                            onMouseEnter={() => setIndex(at)}
                                            onClick={() => pick(row)}
                                        >
                                            <Icon icon={cardGlyph(row.kind, row.card)} size={14} className="shrink-0 text-text-faint" />
                                            <span className="min-w-0 truncate">{row.label}</span>
                                            <span className="ml-auto shrink-0 pl-3 text-xs text-text-faint">{row.source}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
