import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Cpu, Sparkles } from 'lucide-react';
import { fileUriToPath } from '@adecore/lsp';
import type { EditorRect } from '@adecore/editor';
import { Button, Icon } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { basenameOf } from '@/shell/panels/files-tree';
import { AnchoredPopup } from './AnchoredPopup';
import type { EditorLanguage } from './editor-language';
import type { RenameView } from './popups';

const CARD_ATTRIBUTE = 'data-rename-card';

/* Whether the focus moved to something that belongs to the rename, which is not leaving it. */
function staysInside(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(`[${CARD_ATTRIBUTE}]`) !== null;
}

/*
 * The names the model on the machine proposes, in a list under the input; a press fills the input and the
 * typed name stays what Enter applies. While it is up the card says only its two keys.
 */
function Suggestions({ names, active, onPick }: { names: readonly string[]; active: number; onPick(name: string): void }) {
    const { t } = useTranslation('panels');
    return (
        <div className="flex w-[250px] flex-col p-1.25">
            <div className="flex items-center gap-1.5 px-2.25 pt-1.25 pb-1 text-xs font-semibold text-text-faint">
                <Icon icon={Cpu} size={12} className="shrink-0" />
                {t('language.rename.suggestions')}
            </div>
            {names.map((name, index) => (
                <button
                    key={name}
                    type="button"
                    tabIndex={-1}
                    className={`flex h-6.5 items-center gap-2 rounded-md px-2.25 text-left font-mono text-code text-text ${index === active ? 'bg-accent/20' : 'hover:bg-surface-hover'}`}
                    onClick={() => onPick(name)}
                >
                    <Icon icon={Sparkles} size={12} className={`shrink-0 ${index === active ? 'text-accent' : 'text-text-faint'}`} />
                    {name}
                </button>
            ))}
            <div className="mt-1 flex gap-3 border-t border-border px-2.25 pt-1.75 pb-0.75 text-xs text-text-muted">
                <span>↵ {t('language.rename.rename')}</span>
                <span>⇥ {t('language.rename.useSuggestion')}</span>
            </div>
        </div>
    );
}

function Hints({ view, active, onPick }: { view: RenameView; active: number; onPick(name: string): void }) {
    const { t } = useTranslation('panels');
    const { occurrences } = view;
    return (
        <div className="flex flex-col">
            {view.error !== null && (
                <div role="alert" className="max-w-[420px] px-2.5 py-1.5 text-xs text-status-error">
                    {view.error}
                </div>
            )}
            {view.suggestions.length > 0 ? (
                <Suggestions names={view.suggestions} active={active} onPick={onPick} />
            ) : (
                <div className="flex items-center gap-3 px-2.5 py-1.5 text-xs whitespace-nowrap text-text-muted">
                    {occurrences !== null && (
                        <span>
                            {occurrences.files > 1
                                ? t('language.rename.occurrencesFiles', {
                                      count: occurrences.count,
                                      formatted: formatNumber(occurrences.count),
                                      files: formatNumber(occurrences.files)
                                  })
                                : t('language.rename.occurrences', { count: occurrences.count, formatted: formatNumber(occurrences.count) })}
                        </span>
                    )}
                    <span>↵ {t('language.rename.rename')}</span>
                    <span>⇧↵ {t('language.rename.preview')}</span>
                </div>
            )}
        </div>
    );
}

function Preview({ language, view }: { language: EditorLanguage; view: RenameView }) {
    const { t } = useTranslation('panels');
    const folder = language.project.folder;
    return (
        <div className="flex w-[520px] max-w-full flex-col" onPointerDown={(event) => event.preventDefault()}>
            <div className="max-h-[320px] overflow-y-auto">
                {view.files.map((file) => {
                    const path = fileUriToPath(file.uri);
                    const shown = path === null ? file.uri : path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
                    return (
                        <div key={file.uri} className="border-b border-border last:border-b-0">
                            <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                                <span className="font-medium">{path === null ? shown : basenameOf(path)}</span>
                                <span className="min-w-0 truncate text-text-faint">{shown}</span>
                            </div>
                            <div className="flex flex-col gap-px px-1 pb-1.5 font-mono text-code">
                                {file.rows.map((row) => (
                                    <div key={row.line} className="flex flex-col gap-px">
                                        <div className="flex gap-2 rounded-sm bg-status-error/10 px-1.5 whitespace-pre">
                                            <span className="w-8 shrink-0 text-right text-text-faint">{row.line}</span>
                                            <span className="min-w-0 truncate">{row.before}</span>
                                        </div>
                                        <div className="flex gap-2 rounded-sm bg-status-idle/10 px-1.5 whitespace-pre">
                                            <span className="w-8 shrink-0" />
                                            <span className="min-w-0 truncate">{row.after}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border p-2">
                <Button size="xs" variant="ghost" onClick={() => language.rename.cancel()}>
                    {t('language.rename.cancel')}
                </Button>
                <Button size="xs" variant="primary" onClick={() => void language.rename.confirm()}>
                    {t('language.rename.apply')}
                </Button>
            </div>
        </div>
    );
}

/*
 * The rename of a symbol: an input over the symbol itself, and under it either the count of its places with
 * the keys, or after Shift+Enter the lines the rename would change. The input keeps the focus the whole time,
 * so Enter and Escape mean the same in both, and the focus leaving the card means the person went elsewhere.
 */
export function RenameCard({ language, view, rect, endRect }: { language: EditorLanguage; view: RenameView; rect: EditorRect; endRect: EditorRect | null }) {
    const input = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(view.placeholder);
    const [active, setActive] = useState(0);

    useLayoutEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, []);

    function fill(name: string): void {
        setValue(name);
        language.rename.edited();
        input.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        const names = view.phase === 'input' ? view.suggestions : [];
        if (names.length > 0 && !event.nativeEvent.isComposing && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (step !== 0 || event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Tab') {
                    fill(names[Math.min(active, names.length - 1)]!);
                } else {
                    setActive((active + step + names.length) % names.length);
                }
                return;
            }
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            language.rename.cancel();
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            if (view.phase === 'preview') {
                void language.rename.confirm();
            } else if (!view.busy) {
                void language.rename.submit(value, event.shiftKey);
            }
        }
    }

    const symbolWidth = endRect === null ? 0 : Math.max(0, endRect.left - rect.left);
    return createPortal(
        <>
            <input
                ref={input}
                {...{ [CARD_ATTRIBUTE]: '' }}
                value={view.phase === 'preview' ? view.name : value}
                readOnly={view.phase === 'preview' || view.busy}
                spellCheck={false}
                autoComplete="off"
                aria-label={view.original}
                className="fixed z-(--z-popup) rounded-sm border border-accent bg-surface px-1 font-mono text-code text-text shadow-(--float-shadow) outline-none [field-sizing:content]"
                style={{
                    left: Math.round(rect.left) - 5,
                    top: Math.round(rect.top) - 2,
                    height: Math.round(rect.bottom - rect.top) + 4,
                    minWidth: Math.round(symbolWidth) + 10
                }}
                onChange={(event) => {
                    setValue(event.target.value);
                    language.rename.edited();
                }}
                onKeyDown={onKeyDown}
                onBlur={(event) => {
                    if (!staysInside(event.relatedTarget)) {
                        language.rename.cancel();
                    }
                }}
            />
            <AnchoredPopup rect={{ ...rect, top: rect.top - 2, bottom: rect.bottom + 2 }} className="overflow-hidden" placement={{ gap: 2 }}>
                <div {...{ [CARD_ATTRIBUTE]: '' }} onPointerDown={(event) => event.preventDefault()}>
                    {view.phase === 'preview' ? <Preview language={language} view={view} /> : <Hints view={view} active={active} onPick={fill} />}
                </div>
            </AnchoredPopup>
        </>,
        document.body
    );
}
