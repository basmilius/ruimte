import { CommandPalette as Palette } from '@adecore/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paletteStart, type PaletteSignal } from '@/shell/palette-browse';
import type { PaletteContext, PaletteGroup, PaletteKeyEvent, PaletteModeView, PaletteRow } from '@/shell/palette-entries';
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
    // Only the keys read it, so following the highlight redraws nothing.
    const highlighted = useRef<PaletteRow | undefined>(undefined);
    const close = (): void => setOpen(false);
    const context: PaletteContext = { open, query, setQuery, close };

    const browse = usePaletteBrowse(context, grepping || chatting);
    const browsing = browse.browsing;
    const files = usePaletteFiles(context, { skip: grepping || browsing, picking });
    const grep = usePaletteGrep(context, { enabled: grepping, folder: files.folder, openFile: files.openFile });
    const chats = usePaletteChats(context, chatting);
    const commands = usePaletteCommands(context, files.files, !grepping && !chatting && !browsing && !picking);
    const view: PaletteModeView = grepping ? grep : chatting ? chats : browsing ? browse.view : picking ? files.view : commands;
    const virtualized = view.virtualized === true;

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

    const label = grepping ? t('palette.searchFiles') : chatting ? t('palette.searchChats') : picking ? t('palette.pickFile') : t('palette.inputLabel');
    const placeholder = grepping || chatting || picking ? label : browsing ? browse.placeholder : t('palette.placeholder');

    const keyDown = (event: PaletteKeyEvent): void => {
        if (event.key === 'Backspace' && query === '' && view.back !== undefined) {
            event.preventDefault();
            view.back();
            return;
        }
        view.keyDown?.(event, highlighted.current);
    };

    return (
        <Palette.Root<PaletteRow>
            open={open && entered}
            onOpenChange={setOpen}
            onOpenChangeComplete={(isOpen) => !isOpen && onClosed()}
            items={view.groups}
            filter={null}
            virtualized={virtualized}
            value={query}
            onValueChange={(next, details) => {
                // A picked row runs; the field keeps what was typed rather than the row's name.
                if (details.reason === 'item-press') {
                    return;
                }
                setQuery(next);
                browse.typed(next);
            }}
            onItemHighlighted={(row) => {
                highlighted.current = row;
            }}
        >
            {/* Wider while searching in files and chats, since source lines and messages do not fold. */}
            <Palette.Popup size={grepping || chatting ? 'lg' : 'md'}>
                <Palette.Input
                    aria-label={label}
                    placeholder={placeholder}
                    /* A path stays in the sans font: monospace makes it read as something to read rather than to type. */
                    mono={grepping}
                    leading={view.leading}
                    trailing={view.trailing}
                    escapeHint={!browsing}
                    onKeyDown={keyDown}
                />
                <Palette.Empty>{view.empty}</Palette.Empty>
                {virtualized ? (
                    <Palette.VirtualList<PaletteRow, PaletteGroup<PaletteRow>> groupLabel={(group) => group.label}>
                        {(row, itemProps) => view.item(row, itemProps)}
                    </Palette.VirtualList>
                ) : (
                    <Palette.List>
                        {(group: PaletteGroup<PaletteRow>) => (
                            <Palette.Group key={group.value} items={group.items}>
                                <Palette.GroupLabel>{group.label}</Palette.GroupLabel>
                                <Palette.Collection>{(row: PaletteRow) => view.item(row)}</Palette.Collection>
                            </Palette.Group>
                        )}
                    </Palette.List>
                )}
                <Palette.Status>{view.status}</Palette.Status>
                {view.footer !== undefined && <Palette.Footer>{view.footer}</Palette.Footer>}
            </Palette.Popup>
        </Palette.Root>
    );
}
