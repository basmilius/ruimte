import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Globe, LayoutGrid, MessageSquare, Search, Terminal, Zap } from 'lucide-react';
import { appCommands, type Command } from '@/shell/commands';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useUi } from '@/state/ui';

const KIND_ICON: Record<NodeKind, React.ReactNode> = {
    terminal: <Terminal size={14} />,
    chat: <MessageSquare size={14} />,
    browser: <Globe size={14} />,
    group: <LayoutGrid size={14} />
};

interface Entry extends Command {
    icon: React.ReactNode;
    section: 'Jump to' | 'Actions';
}

const matches = (query: string, text: string): boolean => {
    // Every typed word has to appear somewhere, in any order.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
};

/* Cmd+K: jump to a node or run an action, all from the keyboard. */
export function CommandPalette() {
    const open = useUi((s) => s.paletteOpen);
    const setOpen = useUi((s) => s.setPaletteOpen);
    const nodes = useCanvas((s) => s.nodes);
    const order = useCanvas((s) => s.order);
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const entries = useMemo<Entry[]>(() => {
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
        const actions: Entry[] = appCommands().map((command) => ({ ...command, icon: <Zap size={14} />, section: 'Actions' }));
        return [...jumps, ...actions].filter((entry) => query === '' || matches(query, `${entry.label} ${entry.hint ?? ''}`));
    }, [nodes, order, query]);

    const active = entries[Math.min(index, entries.length - 1)];

    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        setOpen(false);
        entry.run();
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                // A fresh search every time it opens; the last query is never what the person wants next.
                if (next) {
                    setQuery('');
                    setIndex(0);
                }
                setOpen(next);
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[18vh] w-[520px]" initialFocus={inputRef}>
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        <Search size={15} className="shrink-0 text-text-faint" />
                        <input
                            ref={inputRef}
                            className="h-11 w-full bg-transparent text-[14px] text-text outline-none placeholder:text-text-faint"
                            placeholder="Jump to a node or run a command"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setIndex(0);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    run(active);
                                }
                            }}
                        />
                        <kbd className="tooltip-kbd">esc</kbd>
                    </div>
                    <div className="max-h-[50vh] overflow-auto p-1.5" role="listbox">
                        {entries.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-text-faint">Nothing matches</div>}
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
                                        <span className="min-w-0 truncate">{entry.label}</span>
                                        {entry.hint && <span className="text-[11px] text-text-faint">{entry.hint}</span>}
                                        <span className="grow" />
                                        {entry.shortcut && <kbd className="tooltip-kbd">{entry.shortcut}</kbd>}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
