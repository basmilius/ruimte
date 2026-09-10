import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import {
    CornerLeftUpIcon,
    Folder01Icon,
    FolderCheckIcon,
    FolderPlusIcon,
    GlobeIcon,
    LayoutGridIcon,
    MessageSquareIcon,
    Search01Icon,
    StickyNote03Icon,
    TerminalIcon,
    ZapIcon
} from '@hugeicons/core-free-icons';
import type { FsBrowseEntry } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { projectClient } from '@/project';
import { appCommands, type Command } from '@/shell/commands';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Icon } from '@/ui/Icon';

const KIND_ICON: Record<NodeKind, React.ReactNode> = {
    terminal: <Icon icon={TerminalIcon} size={14} />,
    chat: <Icon icon={MessageSquareIcon} size={14} />,
    browser: <Icon icon={GlobeIcon} size={14} />,
    group: <Icon icon={LayoutGridIcon} size={14} />,
    note: <Icon icon={StickyNote03Icon} size={14} />
};

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
const isPathQuery = (query: string): boolean => query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');

const BROWSE_DEBOUNCE_MS = 60;

interface Entry extends Command {
    icon: React.ReactNode;
    section: 'Jump to' | 'Actions' | 'Folders';
}

const matches = (query: string, text: string): boolean => {
    // Every typed word has to appear somewhere, in any order.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
};

const parentOf = (path: string): string | null => {
    const trimmed = path.replace(/\/+$/, '');
    const cut = trimmed.lastIndexOf('/');
    if (cut <= 0) {
        return trimmed === '' || trimmed === '/' ? null : '/';
    }
    return `${trimmed.slice(0, cut)}/`;
};

/* Cmd+K: jump to a node, run an action, or type a path to open a folder as a project. */
export function CommandPalette() {
    const open = useUi((s) => s.paletteOpen);
    const seed = useUi((s) => s.paletteSeed);
    const setOpen = useUi((s) => s.setPaletteOpen);
    const nodes = useCanvas((s) => s.nodes);
    const order = useCanvas((s) => s.order);
    const folder = useProject((s) => s.current?.folder ?? null);
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const [browse, setBrowse] = useState<{ parentPath: string; entries: FsBrowseEntry[] } | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const generation = useRef(0);

    const reset = (next: string): void => {
        setQuery(next);
        setIndex(isPathQuery(next) ? -1 : 0);
        setFailure(null);
        setBrowse(null);
    };

    const [seenOpen, setSeenOpen] = useState(false);

    // Opening is driven by the store, not by the dialog, so the fresh start is derived while rendering.
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) {
            reset(seed);
        }
    }

    const browsing = isPathQuery(query);

    useEffect(() => {
        if (!browsing) {
            return;
        }
        const mine = ++generation.current;
        const timer = window.setTimeout(() => {
            transport
                .request('fs.browse', { partialPath: query, cwd: folder ?? undefined })
                .then((result) => {
                    // A later keystroke already asked again; this answer is stale.
                    if (mine === generation.current) {
                        setBrowse(result);
                        setFailure(null);
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setBrowse({ parentPath: query, entries: [] });
                        setFailure(e instanceof Error ? e.message : 'That path cannot be read');
                    }
                });
        }, BROWSE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [browsing, query, folder]);

    const submitPath = async (path: string): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await projectClient.openFolder(path);
            setOpen(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That folder cannot be opened');
        } finally {
            setBusy(false);
        }
    };

    const entries = useMemo<Entry[]>(() => {
        if (browsing) {
            const up = parentOf(query);
            const list: Entry[] = [];
            if (up !== null && query !== '/' && query !== '~/') {
                list.push({
                    id: 'browse-up',
                    label: '..',
                    hint: 'Up one folder',
                    icon: <Icon icon={CornerLeftUpIcon} size={14} />,
                    section: 'Folders',
                    run: () => setQuery(up)
                });
            }
            for (const entry of browse?.entries ?? []) {
                list.push({
                    id: `dir-${entry.fullPath}`,
                    label: entry.name,
                    hint: entry.hasCanvas ? 'Has a canvas' : undefined,
                    icon: entry.hasCanvas ? <Icon icon={FolderCheckIcon} size={14} /> : <Icon icon={Folder01Icon} size={14} />,
                    section: 'Folders',
                    run: () => setQuery(`${entry.fullPath}/`)
                });
            }
            return list;
        }
        const jumps: Entry[] = order
            .map((id) => nodes[id]!)
            .filter((node) => node.kind !== 'group')
            .map((node) => ({
                id: `node-${node.id}`,
                label: node.title,
                hint: node.kind,
                icon: KIND_ICON[node.kind],
                section: 'Jump to',
                run: () => useCanvas.getState().goToNode(node.id)
            }));
        const actions: Entry[] = appCommands().map((command) => ({
            ...command,
            icon: command.agent ? <AgentIcon kind={command.agent} /> : <Icon icon={ZapIcon} size={14} />,
            section: 'Actions'
        }));
        return [...jumps, ...actions].filter((entry) => query === '' || matches(query, `${entry.label} ${entry.hint ?? ''}`));
    }, [browsing, browse, nodes, order, query]);

    // While browsing nothing is highlighted until the arrows say so, so Enter opens what was typed.
    const active = browsing ? (index >= 0 ? entries[index] : undefined) : entries[Math.min(index, entries.length - 1)];

    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        if (browsing) {
            entry.run();
            setIndex(-1);
            return;
        }
        setOpen(false);
        entry.run();
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[18vh] w-[560px]" initialFocus={inputRef}>
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        {browsing ? (
                            <Icon icon={FolderPlusIcon} size={15} className="shrink-0 text-accent" />
                        ) : (
                            <Icon icon={Search01Icon} size={15} className="shrink-0 text-text-faint" />
                        )}
                        <input
                            ref={inputRef}
                            className={clsx(
                                'h-11 w-full bg-transparent text-[14px] text-text outline-none placeholder:text-text-faint',
                                browsing && 'font-mono text-[13px]'
                            )}
                            placeholder="Jump to a node, run a command, or type a path like ~/projects to open a folder"
                            value={query}
                            spellCheck={false}
                            onChange={(e) => reset(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setIndex((i) => (entries.length === 0 ? -1 : (i + 1) % entries.length));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setIndex((i) => (entries.length === 0 ? -1 : (i - 1 + entries.length) % entries.length));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (browsing && (active === undefined || e.metaKey || e.ctrlKey)) {
                                        void submitPath(query);
                                    } else {
                                        run(active);
                                    }
                                } else if (e.key === 'Tab' && browsing && active) {
                                    e.preventDefault();
                                    run(active);
                                }
                            }}
                        />
                        <kbd className="tooltip-kbd">esc</kbd>
                    </div>
                    <div className="max-h-[50vh] overflow-auto p-1.5" role="listbox">
                        {entries.length === 0 && !browsing && <div className="px-3 py-6 text-center text-[12px] text-text-faint">Nothing matches</div>}
                        {entries.length === 0 && browsing && <div className="px-3 py-6 text-center text-[12px] text-text-faint">No folders here yet</div>}
                        {entries.map((entry, i) => {
                            const first = i === 0 || entries[i - 1]!.section !== entry.section;
                            return (
                                <div key={entry.id}>
                                    {first && <div className="menu-label">{entry.section}</div>}
                                    <button
                                        role="option"
                                        aria-selected={entry === active}
                                        className={clsx(
                                            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px]',
                                            entry === active ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                        )}
                                        onMouseEnter={() => setIndex(i)}
                                        onClick={() => run(entry)}
                                    >
                                        <span className="shrink-0 text-text-faint">{entry.icon}</span>
                                        <span className={clsx('min-w-0 truncate', browsing && 'font-mono text-[12.5px]')}>{entry.label}</span>
                                        {entry.hint && <span className="text-[11px] text-text-faint">{entry.hint}</span>}
                                        <span className="grow" />
                                        {entry.shortcut && <kbd className="tooltip-kbd">{entry.shortcut}</kbd>}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {browsing && (
                        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-text-faint">
                            {failure ? (
                                <span className="text-status-error">{failure}</span>
                            ) : (
                                <span>
                                    <kbd className="tooltip-kbd">↵</kbd> steps into a folder, <kbd className="tooltip-kbd">⌘↵</kbd> opens the typed path as a
                                    project
                                </span>
                            )}
                            <span className="grow" />
                            {desktop() && (
                                <button
                                    className="inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-text-muted hover:bg-surface-sunken hover:text-text"
                                    onClick={() =>
                                        void desktop()
                                            ?.pickFolder(browse?.parentPath)
                                            .then((picked) => (picked ? submitPath(picked) : undefined))
                                    }
                                >
                                    Browse…
                                </button>
                            )}
                            <button
                                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-text disabled:opacity-50"
                                disabled={busy || query.trim() === ''}
                                onClick={() => void submitPath(query)}
                            >
                                <Icon icon={FolderPlusIcon} size={13} /> Open as project
                            </button>
                        </div>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
