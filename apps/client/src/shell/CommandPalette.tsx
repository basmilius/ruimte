import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { CornerLeftUp, Folder, FolderCheck, FolderPlus, Globe, LayoutGrid, MessageSquare, Search, StickyNote, Terminal, Zap } from 'lucide-react';
import type { FsBrowseEntry } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { projectClient } from '@/project';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { appCommands, type Command } from '@/shell/commands';
import { readRecents, rememberRecent, sortByRecency } from '@/shell/palette-recents';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const KIND_ICON: Record<NodeKind, React.ReactNode> = {
    terminal: <Icon icon={Terminal} size={14} />,
    chat: <Icon icon={MessageSquare} size={14} />,
    browser: <Icon icon={Globe} size={14} />,
    group: <Icon icon={LayoutGrid} size={14} />,
    note: <Icon icon={StickyNote} size={14} />
};

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
const isPathQuery = (query: string): boolean => query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');

const BROWSE_DEBOUNCE_MS = 60;

interface Entry extends Command {
    icon: React.ReactNode;
    section: 'Recent' | 'Jump to' | 'Projects' | 'Actions' | 'Folders';
}

const LIST_ID = 'palette-list';
const optionId = (index: number): string => `palette-option-${index}`;

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
    const projects = useProject((s) => s.projects);
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const [browse, setBrowse] = useState<{ parentPath: string; entries: FsBrowseEntry[] } | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [recents, setRecents] = useState<string[]>(readRecents);
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
                    icon: <Icon icon={CornerLeftUp} size={14} />,
                    section: 'Folders',
                    run: () => setQuery(up)
                });
            }
            for (const entry of browse?.entries ?? []) {
                list.push({
                    id: `dir-${entry.fullPath}`,
                    label: entry.name,
                    hint: entry.hasCanvas ? 'Has a canvas' : undefined,
                    icon: entry.hasCanvas ? <Icon icon={FolderCheck} size={14} /> : <Icon icon={Folder} size={14} />,
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
        const switches: Entry[] = projects
            .filter((project) => project.available && project.projectId !== currentProjectId)
            .map((project) => ({
                id: `project-${project.projectId}`,
                label: project.name,
                hint: project.folder ?? 'Not in a folder',
                icon: <ProjectGlyph projectId={project.projectId} icon={project.icon} color={project.color} size={14} />,
                section: 'Projects',
                run: () => void projectClient.openProject(project.projectId).catch(() => undefined)
            }));
        const commands = appCommands();
        const asEntry = (command: Command, section: Entry['section']): Entry => ({
            ...command,
            icon: command.agent ? <AgentIcon kind={command.agent} /> : <Icon icon={Zap} size={14} />,
            section
        });
        if (query === '') {
            // An empty palette is the one moment there is room to offer what you reach for most.
            const split = sortByRecency(commands, recents);
            return [
                ...split.recent.map((command) => asEntry(command, 'Recent')),
                ...jumps,
                ...switches,
                ...split.rest.map((command) => asEntry(command, 'Actions'))
            ];
        }
        return [...jumps, ...switches, ...commands.map((command) => asEntry(command, 'Actions'))].filter((entry) =>
            matches(query, `${entry.label} ${entry.hint ?? ''}`)
        );
    }, [browsing, browse, nodes, order, query, recents, projects, currentProjectId]);

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
        // Jumping to a node or a project is not a command; only what "Actions" lists comes back.
        if (entry.section !== 'Jump to' && entry.section !== 'Projects') {
            setRecents(rememberRecent(entry.id));
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
                            <Icon icon={FolderPlus} size={14} className="shrink-0 text-accent" />
                        ) : (
                            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                        )}
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded
                            aria-controls={LIST_ID}
                            aria-autocomplete="list"
                            aria-activedescendant={active ? optionId(entries.indexOf(active)) : undefined}
                            aria-label="Jump to a node, run a command, or open a folder"
                            className={clsx(
                                'h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
                                browsing && 'font-mono text-code'
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
                    <div id={LIST_ID} className="max-h-[50vh] overflow-auto p-1.5" role="listbox" aria-label="Results">
                        <div aria-live="polite">
                            {entries.length === 0 && !browsing && <div className="px-3 py-6 text-center text-xs text-text-faint">Nothing matches</div>}
                            {entries.length === 0 && browsing && <div className="px-3 py-6 text-center text-xs text-text-faint">No folders here yet</div>}
                        </div>
                        {entries.map((entry, i) => {
                            const first = i === 0 || entries[i - 1]!.section !== entry.section;
                            return (
                                <div key={entry.id}>
                                    {first && <div className="section-label px-2.5 pt-1.5 pb-1">{entry.section}</div>}
                                    <button
                                        id={optionId(i)}
                                        role="option"
                                        aria-selected={entry === active}
                                        className={clsx(
                                            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm',
                                            entry === active ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                        )}
                                        onMouseEnter={() => setIndex(i)}
                                        onClick={() => run(entry)}
                                    >
                                        <span className="shrink-0 text-text-faint">{entry.icon}</span>
                                        <span className={clsx('min-w-0 truncate', browsing && 'font-mono text-code')}>{entry.label}</span>
                                        {entry.hint && <span className="text-xs text-text-faint">{entry.hint}</span>}
                                        <span className="grow" />
                                        {entry.shortcut && <kbd className="tooltip-kbd">{entry.shortcut}</kbd>}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {browsing && (
                        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                            {failure ? (
                                <span className="text-status-error" role="alert">
                                    {failure}
                                </span>
                            ) : (
                                <span>
                                    <kbd className="tooltip-kbd">↵</kbd> steps into a folder, <kbd className="tooltip-kbd">⌘↵</kbd> opens the typed path as a
                                    project
                                </span>
                            )}
                            <span className="grow" />
                            {desktop() && (
                                <Button
                                    size="sm"
                                    onClick={() =>
                                        void desktop()
                                            ?.pickFolder(browse?.parentPath)
                                            .then((picked) => (picked ? submitPath(picked) : undefined))
                                    }
                                >
                                    Browse…
                                </Button>
                            )}
                            <Button size="sm" variant="primary" disabled={busy || query.trim() === ''} onClick={() => void submitPath(query)}>
                                <Icon icon={FolderPlus} size={12} /> Open as project
                            </Button>
                        </div>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
