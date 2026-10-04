import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AtSign, Hash } from 'lucide-react';
import { Icon } from '@basmilius/desktop-ui';
import { formatShortcut } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { basenameOf } from '@/shell/panels/files-tree';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import type { SymbolsView } from './popups';
import { filterEntries, groupEntries, letterOfKind, modeOf, toneOfKind, type SymbolEntry, type SymbolTone, type WorkspaceEntry } from './symbol-picker-model';

const TONES: Record<SymbolTone, string> = {
    callable: 'bg-accent-soft text-accent',
    value: 'bg-status-running/15 text-status-running',
    type: 'bg-status-idle/15 text-status-idle',
    other: 'bg-surface-hover text-text-muted'
};

const SEARCH_DELAY_MS = 200;

function Badge({ kind }: { kind: number }) {
    return (
        <span className={`grid size-4 shrink-0 place-items-center rounded-sm font-mono text-xs font-semibold ${TONES[toneOfKind(kind)]}`}>
            {letterOfKind(kind)}
        </span>
    );
}

/*
 * The picker of go to symbol, over the editor: an input, the symbols of the file in groups by kind, and the
 * keys. The input keeps the focus; Enter goes, Escape and the focus leaving close it.
 */
export function SymbolPicker({ language, view }: { language: EditorLanguage; view: SymbolsView }) {
    const { t } = useTranslation('panels');
    const [input, setInput] = useState('');
    const [active, setActive] = useState(0);
    const [found, setFound] = useState<{ text: string; entries: WorkspaceEntry[] }>({ text: '', entries: [] });
    const activeRow = useRef<HTMLButtonElement>(null);
    const mode = modeOf(input);

    const groups = useMemo(
        () => groupEntries(filterEntries(view.entries, mode.mode === 'symbol' ? mode.text : '')),
        [view.entries, mode.mode === 'symbol' ? mode.text : '']
    );
    const flat: SymbolEntry[] = groups.flatMap((group) => group.entries);
    const places = mode.mode === 'workspace' && found.text === mode.text ? found.entries : [];
    const count = mode.mode === 'workspace' ? places.length : mode.mode === 'line' ? (mode.line === null ? 0 : 1) : flat.length;

    useEffect(() => {
        if (mode.mode !== 'workspace' || mode.text === '') {
            return;
        }
        const controller = new AbortController();
        const text = mode.text;
        const timer = setTimeout(() => {
            language.symbolPicker
                .search(text, controller.signal)
                .then((entries) => !controller.signal.aborted && setFound({ text, entries }))
                .catch(() => undefined);
        }, SEARCH_DELAY_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [language, mode.mode, mode.mode === 'workspace' ? mode.text : '']);

    useEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [active, input]);

    function choose(index: number): void {
        if (mode.mode === 'line') {
            if (mode.line !== null) {
                language.symbolPicker.goToLine(mode.line);
            }
        } else if (mode.mode === 'workspace') {
            const place = places[index];
            if (place !== undefined) {
                language.symbolPicker.goToWorkspace(place);
            }
        } else if (flat[index] !== undefined) {
            language.symbolPicker.goTo(flat[index]!);
        }
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            language.symbolPicker.close();
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            choose(active);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(Math.max(0, Math.min(Math.max(0, count - 1), active + (event.key === 'ArrowDown' ? 1 : -1))));
        }
    }

    let offset = 0;
    return createPortal(
        <div
            className="fixed top-[12vh] left-1/2 z-(--z-popup) flex w-[560px] max-w-[calc(100vw-16px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-text shadow-(--float-shadow)"
            onPointerDown={(event) => event.target !== event.currentTarget && (event.target as HTMLElement).tagName !== 'INPUT' && event.preventDefault()}
        >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Icon icon={mode.mode === 'workspace' ? Hash : AtSign} size={14} className="shrink-0 text-text-muted" />
                <input
                    autoFocus
                    value={input}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('language.symbols.placeholder', { file: view.file })}
                    className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                    onChange={(event) => {
                        setInput(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => language.symbolPicker.close()}
                />
                <span className="shrink-0 text-xs text-text-faint">{formatShortcut(CANVAS_SHORTCUTS.goToSymbol, isApplePlatform())}</span>
            </div>
            <div role="listbox" className="max-h-[320px] overflow-y-auto p-1">
                {mode.mode === 'line' && (
                    <div className="px-2 py-1.5 text-xs text-text-muted">
                        {mode.line === null ? t('language.symbols.lineHint') : t('language.symbols.goToLine', { line: formatNumber(mode.line) })}
                    </div>
                )}
                {mode.mode === 'workspace' &&
                    places.map((place, index) => {
                        const path = fileUriToPath(place.uri);
                        return (
                            <button
                                key={place.id}
                                ref={index === active ? activeRow : undefined}
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                data-active={index === active}
                                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs cursor-row"
                                onClick={() => choose(index)}
                            >
                                <Badge kind={place.kind} />
                                <span className="shrink-0">{place.name}</span>
                                <span className="min-w-0 truncate font-mono text-text-faint">{place.container}</span>
                                <span className="ml-auto shrink-0 font-mono text-text-faint">
                                    {path === null ? '' : basenameOf(path)}:{formatNumber(place.line + 1)}
                                </span>
                            </button>
                        );
                    })}
                {mode.mode === 'symbol' &&
                    groups.map((group) => {
                        const start = offset;
                        offset += group.entries.length;
                        return (
                            <div key={group.group} role="group">
                                <div className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-text-faint">{t(`language.symbols.groups.${group.group}`)}</div>
                                {group.entries.map((entry, index) => {
                                    const position = start + index;
                                    return (
                                        <button
                                            key={entry.id}
                                            ref={position === active ? activeRow : undefined}
                                            type="button"
                                            role="option"
                                            aria-selected={position === active}
                                            data-active={position === active}
                                            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs cursor-row"
                                            onClick={() => choose(position)}
                                        >
                                            <Badge kind={entry.kind} />
                                            <span className="shrink-0">{entry.name}</span>
                                            <span className="min-w-0 truncate font-mono text-text-faint">{entry.detail}</span>
                                            {entry.container !== '' && <span className="min-w-0 truncate text-text-faint">{entry.container}</span>}
                                            <span className="ml-auto shrink-0 font-mono text-text-faint">{formatNumber(entry.line + 1)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                {mode.mode === 'symbol' && flat.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-text-muted">{t('language.symbols.none')}</div>
                )}
                {mode.mode === 'workspace' && places.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-text-muted">
                        {mode.text === '' ? t('language.symbols.workspaceHint') : t('language.symbols.none')}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs whitespace-nowrap text-text-faint">
                <span>↑↓ {t('language.symbols.navigate')}</span>
                <span>↵ {t('language.symbols.open')}</span>
                <button type="button" className="ml-auto hover:text-text" onClick={() => setInput('#')}>
                    # {t('language.symbols.workspace')}
                </button>
                <button type="button" className="hover:text-text" onClick={() => setInput(':')}>
                    : {t('language.symbols.line')}
                </button>
            </div>
        </div>,
        document.body
    );
}
