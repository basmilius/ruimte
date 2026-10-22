import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { FileSearch, FileText, MessageSquare, Search } from 'lucide-react';
import { Dialog, Icon, Kbd, KEY_SHORTCUTS } from '@adecore/ui';
import { paletteStart, type PaletteSignal } from '@/shell/palette-browse';
import { LIST_ID, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { usePaletteBrowse } from '@/shell/use-palette-browse';
import { usePaletteChats } from '@/shell/use-palette-chats';
import { usePaletteCommands } from '@/shell/use-palette-commands';
import { usePaletteFiles } from '@/shell/use-palette-files';
import { usePaletteGrep } from '@/shell/use-palette-grep';
import { useUi } from '@/state/ui';

/*
 * Cmd+K: jump to a node, run an action, or type a path to open a folder as a project. The body follows
 * the canvas, the machines and the projects, so it is mounted only while the palette is up or on its
 * way out. The last browse request it saw stays here, so a body that mounts knows whether this opening browses.
 */
export function CommandPalette() {
    const open = useUi((s) => s.paletteOpen);
    const [mounted, setMounted] = useState(open);
    const [browseSeen, setBrowseSeen] = useState(() => useUi.getState().paletteBrowseAt);
    if (open && !mounted) {
        setMounted(true);
    }
    if (!open && !mounted) {
        return null;
    }
    const onClosed = (): void => {
        const state = useUi.getState();
        if (!state.paletteOpen) {
            setBrowseSeen(state.paletteBrowseAt);
            setMounted(false);
        }
    };
    return <PaletteBody browseSeen={browseSeen} onClosed={onClosed} />;
}

/*
 * The field, the list and the footer every mode shares. Each mode is a hook that is inert while
 * another one is up, so what a person set in one (the toggles of a search, a browse step) is still
 * there when they come back to it while the palette stays open.
 */
function PaletteBody({ browseSeen, onClosed }: { browseSeen: number; onClosed(): void }) {
    const { t } = useTranslation(['shell']);
    const open = useUi((s) => s.paletteOpen);
    const seed = useUi((s) => s.paletteSeed);
    const setOpen = useUi((s) => s.setPaletteOpen);
    const browseAt = useUi((s) => s.paletteBrowseAt);
    const mode = useUi((s) => s.paletteMode);
    const grepping = mode === 'grep';
    const chatting = mode === 'chats';
    /* Picking one file out of the folder, to make it a node or a view. The list is the file search
       and nothing else, and it answers before anything is typed. */
    const picking = mode === 'file';
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const close = (): void => setOpen(false);
    const context: PaletteContext = { open, query, setQuery, index, setIndex, close };

    const browse = usePaletteBrowse(context, grepping || chatting);
    const browsing = browse.browsing;
    const files = usePaletteFiles(context, { skip: grepping || browsing, picking });
    const grep = usePaletteGrep(context, { enabled: grepping, folder: files.folder, openFile: files.openFile });
    const chats = usePaletteChats(context, chatting);
    const commands = usePaletteCommands(context, files.files, !grepping && !chatting && !browsing && !picking);
    const view: PaletteModeView = grepping ? grep : chatting ? chats : browsing ? browse.view : picking ? files.view : commands;

    const signal = { open, mode, browseAt };
    const [seen, setSeen] = useState<PaletteSignal>(() => ({ open: false, mode, browseAt: browseSeen }));
    // Mounted open, the dialog would skip the way in; one frame closed lets it animate like any other.
    const [entered, setEntered] = useState(false);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    // Opening is driven by the store, not by the dialog, so the fresh start is derived while rendering.
    const start = paletteStart(signal, seen);
    if (start.changed) {
        setSeen(signal);
        if (start.restart) {
            browse.restart(seed, start.browse);
        }
    }

    /* The arrow keys move a highlight, not the scroll: without this the list stays where it is and
       the selection walks off the bottom of it. `nearest` keeps a click from jumping the list. */
    useEffect(() => {
        document.getElementById(LIST_ID)?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    });

    const label = grepping ? t('palette.searchFiles') : chatting ? t('palette.searchChats') : picking ? t('palette.pickFile') : t('palette.inputLabel');
    const placeholder = grepping || chatting || picking ? label : browsing ? browse.placeholder : t('palette.placeholder');
    const count = view.count;

    return (
        <Dialog.Root open={open && entered} onOpenChange={setOpen} onOpenChangeComplete={(isOpen) => !isOpen && onClosed()}>
            <Dialog.Popup
                /* Wider while searching in files, since source lines do not fold. Never centered: the
                   popup changes height with every keystroke, and a centered list would walk up the screen. */
                className={clsx('top-[18vh] [translate:-50%_0]', grepping || chatting ? 'w-[760px]' : 'w-[576px]')}
                initialFocus={inputRef}
            >
                <div className="relative flex items-center gap-2 border-b border-border px-3">
                    {view.overlay}
                    {view.leading}
                    {grepping && <Icon icon={FileSearch} size={14} className="shrink-0 text-accent" />}
                    {chatting && <Icon icon={MessageSquare} size={14} className="shrink-0 text-accent" />}
                    {picking && <Icon icon={FileText} size={14} className="shrink-0 text-accent" />}
                    {!browsing && !grepping && !chatting && !picking && <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />}
                    <input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded
                        aria-controls={LIST_ID}
                        aria-autocomplete="list"
                        aria-activedescendant={view.activeOptionId}
                        aria-label={label}
                        /* A path stays in the sans font: monospace makes it read as something to read rather than to type. */
                        className={clsx(
                            'h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
                            grepping && 'font-mono text-code'
                        )}
                        placeholder={placeholder}
                        value={query}
                        spellCheck={false}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            browse.typed(e.target.value);
                            setIndex(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setIndex((i) => (count === 0 ? 0 : (i + 1) % count));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setIndex((i) => (count === 0 ? 0 : (i - 1 + count) % count));
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                view.enter(e);
                            } else if (e.key === 'Tab') {
                                if (view.tab?.() === true) {
                                    e.preventDefault();
                                }
                            } else if (e.key === 'Backspace' && query === '') {
                                if (view.back?.() === true) {
                                    e.preventDefault();
                                }
                            }
                        }}
                    />
                    {view.trailing}
                    {!browsing && <Kbd shortcut={KEY_SHORTCUTS.escape} variant="inline" />}
                </div>
                {/* The field keeps the keys, and the highlight is only `aria-activedescendant`. Chromium reports
                    that row as the focused element, so an assistive tool that focuses it before typing would
                    otherwise pull the keys out of the field. */}
                <div
                    id={LIST_ID}
                    className="max-h-[50vh] overflow-auto p-1.5"
                    role="listbox"
                    aria-label={t('palette.results')}
                    onMouseDown={(e) => {
                        if (isOption(e.target)) {
                            e.preventDefault();
                        }
                    }}
                    onFocus={(e) => {
                        if (isOption(e.target)) {
                            inputRef.current?.focus();
                        }
                    }}
                >
                    <div aria-live="polite">{view.notes}</div>
                    {view.results}
                </div>
                {view.footer}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function isOption(target: EventTarget): boolean {
    return target instanceof Element && target.closest('[role="option"]') !== null;
}
