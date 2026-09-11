import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { ChevronRight, CornerLeftUp, Eye, Folder, FolderCheck, FolderOpen, FolderPlus, House } from 'lucide-react';
import type { FsBrowseResult } from '@ruimte/contracts';
import { projectClient } from '@/project';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { describeMachine } from '@/shell/connection-info';
import { breadcrumbOf, folderPresence, joinPath, parentOf, separatorFor, shortcutsFor, startFolder } from '@/shell/folder-picker';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Button } from '@/ui/Button';
import { SECTION_LABEL, TOOLTIP_KBD } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const BROWSE_DEBOUNCE_MS = 60;

const LIST_ID = 'folder-picker-list';
const optionId = (index: number): string => `folder-picker-option-${index}`;

interface Row {
    /* The path a click or Enter puts in the field, listed whole. */
    path: string;
    name: string;
    hasCanvas: boolean;
    /* The synthetic row to the parent, which completes to nothing and marks no canvas. */
    up: boolean;
}

/*
 * Picking a folder to open as a project, on the machine that is being worked on. One editable path
 * field with a breadcrumb under it, the folders of one directory next to a rail of places worth
 * starting from, and a button that creates the folder when the path names one that is not there.
 */
export function FolderPicker() {
    const open = useUi((s) => s.folderPickerOpen);
    const seed = useUi((s) => s.folderPickerSeed);
    const setOpen = useUi((s) => s.setFolderPickerOpen);
    const endpointId = useEndpoints((s) => s.activeId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const platform = useServer((s) => s.platform);
    const home = useServer((s) => s.home);
    const machineLabel = useServer((s) => s.label);
    const reachability = useServer((s) => s.reachability);
    const projects = useProject((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const [path, setPath] = useState('');
    const [index, setIndex] = useState(-1);
    const [result, setResult] = useState<FsBrowseResult | null>(null);
    const [hidden, setHidden] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const generation = useRef(0);

    const sep = separatorFor(platform);
    // The folder of the open project counts as a starting point only on the machine it is on.
    const folder = currentEndpointId === endpointId ? (current?.folder ?? null) : null;

    const goTo = (next: string): void => {
        setPath(next);
        setIndex(-1);
        setFailure(null);
    };

    const [seenOpen, setSeenOpen] = useState(false);

    // The store opens the dialog, so the fresh start is derived while rendering, as the palette does.
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) {
            setResult(null);
            goTo(seed === '' ? startFolder(folder, home, sep) : seed);
        }
    }

    useEffect(() => {
        if (!open || path.trim() === '') {
            return;
        }
        const mine = ++generation.current;
        const timer = window.setTimeout(() => {
            transport
                .request('fs.browse', { partialPath: path, cwd: folder ?? undefined, hidden })
                .then((answer) => {
                    // A later keystroke already asked again; this answer is stale.
                    if (mine === generation.current) {
                        setResult(answer);
                        setFailure(null);
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setResult(null);
                        setFailure(e instanceof Error ? e.message : 'That path cannot be read');
                    }
                });
        }, BROWSE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [open, path, hidden, folder]);

    const up = parentOf(path, sep);
    const crumbs = useMemo(() => breadcrumbOf(path, sep), [path, sep]);
    const shortcuts = useMemo(
        () => shortcutsFor({ endpointId, home, current: current ? { ...current, endpointId: currentEndpointId } : null, projects, sep }),
        [endpointId, home, current, currentEndpointId, projects, sep]
    );
    const presence = folderPresence(path, result, sep);
    const rows = useMemo<Row[]>(() => {
        const list: Row[] = up === null ? [] : [{ path: up, name: '..', hasCanvas: false, up: true }];
        for (const entry of result?.entries ?? []) {
            list.push({ path: `${entry.fullPath}${sep}`, name: entry.name, hasCanvas: entry.hasCanvas, up: false });
        }
        return list;
    }, [result, sep, up]);

    const active = index >= 0 ? rows[index] : undefined;
    const bridge = desktop();
    // A native dialog reads this machine's disk, which is the wrong disk for every other daemon.
    const native = bridge !== null && endpointId === LOCAL_ENDPOINT_ID;
    const missing = presence === 'missing';

    const submit = async (target: string, create: boolean): Promise<void> => {
        if (target.trim() === '') {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            await projectClient.openFolder(target.trim(), create);
            setOpen(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That folder cannot be opened');
        } finally {
            setBusy(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        // The canvas answers chords from anywhere; a dialog with a field of its own keeps them here.
        if (e.key !== 'Escape') {
            e.stopPropagation();
        }
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === 'ArrowUp') {
            e.preventDefault();
            if (up !== null) {
                goTo(up);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((at) => (rows.length === 0 ? -1 : (at + 1) % rows.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((at) => (rows.length === 0 ? -1 : (at - 1 + rows.length) % rows.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (active && !mod) {
                goTo(active.path);
            } else {
                void submit(path, missing);
            }
        } else if (e.key === 'Tab' && active && !active.up) {
            // Completing is not stepping in: the name lands in the field and the list stays put.
            e.preventDefault();
            setPath(joinPath(result?.parentPath ?? path, active.name, sep));
            setIndex(-1);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[14vh] flex h-[480px] w-[720px] flex-col" initialFocus={inputRef}>
                    <Dialog.Title className="sr-only">Open a folder as a project</Dialog.Title>
                    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
                        <div className="flex items-center gap-2">
                            <Icon icon={FolderOpen} size={14} className="shrink-0 text-accent" />
                            <input
                                ref={inputRef}
                                role="combobox"
                                aria-expanded
                                aria-controls={LIST_ID}
                                aria-autocomplete="list"
                                aria-activedescendant={active ? optionId(index) : undefined}
                                aria-label="Folder to open"
                                className="field h-8 font-mono text-code"
                                placeholder="Type a path"
                                value={path}
                                spellCheck={false}
                                onChange={(e) => goTo(e.target.value)}
                                onKeyDown={onKeyDown}
                            />
                            {/* Which machine this list is of; the picker browses the active one, so it cannot lie. */}
                            <span className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-surface-sunken pr-2 text-xs text-text-muted">
                                <ConnectionDot />
                                <span className="max-w-40 truncate">
                                    {describeMachine({
                                        endpointLabel: endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? 'This machine',
                                        machineLabel,
                                        reachability,
                                        platform
                                    })}
                                </span>
                            </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-px overflow-x-auto">
                            {crumbs.map((crumb, at) => (
                                <span key={crumb.path} className="flex shrink-0 items-center gap-px">
                                    {at > 0 && <Icon icon={ChevronRight} size={12} className="text-text-faint" />}
                                    <button
                                        className="cursor-row rounded-sm px-1 py-px font-mono text-code text-text-muted hover:bg-surface-hover hover:text-text"
                                        onClick={() => goTo(crumb.path)}
                                    >
                                        {crumb.label}
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="h-4 text-xs/[16px]" aria-live="polite">
                            {failure !== null ? (
                                <span className="text-status-error" role="alert">
                                    {failure}
                                </span>
                            ) : missing ? (
                                <span className="text-text-muted">This folder does not exist yet. Opening it creates it.</span>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex min-h-0 grow">
                        <div className="w-45 shrink-0 overflow-auto border-r border-border p-1.5">
                            {shortcuts.map((shortcut, at) => (
                                <div key={shortcut.id}>
                                    {shortcut.group === 'recent' && shortcuts[at - 1]?.group !== 'recent' && (
                                        <div className={`${SECTION_LABEL} px-2 pt-2 pb-1`}>Recent</div>
                                    )}
                                    <button
                                        className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-surface-hover"
                                        onClick={() => goTo(shortcut.path)}
                                    >
                                        <span className="flex w-full min-w-0 items-center gap-1.5 text-sm text-text-muted">
                                            <Icon icon={shortcut.group === 'home' ? House : Folder} size={14} className="shrink-0 text-text-faint" />
                                            <span className="min-w-0 truncate">{shortcut.label}</span>
                                        </span>
                                        {shortcut.hint && <span className="w-full truncate pl-5 text-xs text-text-faint">{shortcut.hint}</span>}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div id={LIST_ID} className="min-w-0 grow overflow-auto p-1.5" role="listbox" aria-label="Folders">
                            {rows.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">{missing ? 'Nothing here yet' : 'No folders in here'}</div>
                            )}
                            {rows.map((row, at) => (
                                <button
                                    key={row.path}
                                    id={optionId(at)}
                                    role="option"
                                    aria-selected={at === index}
                                    data-active={at === index}
                                    className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted"
                                    onMouseEnter={() => setIndex(at)}
                                    onClick={() => goTo(row.path)}
                                >
                                    <span className="shrink-0 text-text-faint">
                                        <Icon icon={row.up ? CornerLeftUp : row.hasCanvas ? FolderCheck : Folder} size={14} />
                                    </span>
                                    <span className={clsx('min-w-0 truncate', !row.up && 'font-mono text-code')}>{row.name}</span>
                                    {row.up && <span className="text-xs text-text-faint">Up one folder</span>}
                                    {row.hasCanvas && <span className="text-xs text-text-faint">Has a canvas</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                        <span>
                            <kbd className={TOOLTIP_KBD}>↵</kbd> steps into a folder, <kbd className={TOOLTIP_KBD}>⌘↵</kbd> opens what is typed
                        </span>
                        <span className="grow" />
                        <Tooltip label="Show hidden folders" name>
                            <button
                                className="icon-btn h-7 w-7"
                                aria-pressed={hidden}
                                // The field keeps the keys; a toggle that takes focus would swallow the next arrow.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setHidden(!hidden)}
                            >
                                <Icon icon={Eye} size={14} />
                            </button>
                        </Tooltip>
                        {native && (
                            <Button
                                size="sm"
                                onClick={() =>
                                    void bridge?.pickFolder(result?.parentPath ?? undefined).then((picked) => (picked ? submit(picked, false) : undefined))
                                }
                            >
                                Browse in {fileManagerName(bridge.platform)}
                            </Button>
                        )}
                        <Button size="sm" variant="primary" disabled={busy || path.trim() === ''} onClick={() => void submit(path, missing)}>
                            <Icon icon={missing ? FolderPlus : FolderOpen} size={12} /> {missing ? 'Create and open' : 'Open folder'}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
