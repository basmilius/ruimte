import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from 'react';
import { GitCommitHorizontal, GitCompare, Pin, X } from 'lucide-react';
import { basenameOf } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The open files as a strip of tabs, inside the preview panel's own header. A double-click pins a
 * tab, and a pinned one carries the pin next to its close button.
 * Changes share one tab: the strip keeps the file's name so it stays readable, with the mark that
 * says this is a diff and not the file.
 */
export function FileTabs() {
    const tabs = useFiles((s) => s.tabs);
    const active = useFiles((s) => s.active);
    const counts = useGit((s) => s.counts);
    const stripRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        stripRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    // A trackpad swipes sideways on its own; a wheel with one axis still has to reach the strip.
    const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
        if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
        }
    };

    return (
        <div ref={stripRef} className="files-tab-strip" onWheel={onWheel}>
            {tabs.map((tab) => {
                // One tab holds every change a person opens, so it is named after that and not after
                // the file in it; the file's own name is a hover away. A whole commit is named after
                // the commit, since no file in it is the one it is about.
                const commit = tab.view?.commit;
                const count = counts[tab.key];
                const label = commit !== undefined ? commit.slice(0, 7) : tab.view ? 'Changes' : basenameOf(tab.path);
                return (
                    <span key={tab.key} className="files-tab" data-active={tab.key === active} data-view={tab.view ? 'diff' : undefined}>
                        <Tooltip label={commit !== undefined ? `The commit ${commit.slice(0, 7)}` : tab.view ? basenameOf(tab.path) : tab.path}>
                            <button
                                className="files-tab-open"
                                aria-current={tab.key === active}
                                onClick={() => useFiles.getState().activate(tab.key)}
                                onDoubleClick={() => useFiles.getState().setPinned(tab.key, !tab.pinned)}
                            >
                                {tab.view ? (
                                    <Icon icon={commit === undefined ? GitCompare : GitCommitHorizontal} size={14} className="shrink-0 text-text-faint" />
                                ) : (
                                    <FileIcon path={tab.path} size={14} />
                                )}
                                <span className="files-tab-name">{label}</span>
                                {/* A side that changed nothing has no number: `+0` is noise, and both
                                    at zero is a diff with nothing in it to count. */}
                                {tab.view && count !== undefined && (count.added > 0 || count.deleted > 0) && (
                                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                                        {count.added > 0 && <span className="text-term-green">+{count.added}</span>}
                                        {count.deleted > 0 && <span className="text-term-red">-{count.deleted}</span>}
                                    </span>
                                )}
                                <span className="files-tab-dot" data-dirty={tab.dirty} />
                            </button>
                        </Tooltip>
                        {tab.pinned && <Icon icon={Pin} size={12} className="shrink-0 text-text-muted" />}
                        <Tooltip label={`Close ${label}`} kbd="⌘W" name>
                            <button className="files-tab-close" onClick={() => useFiles.getState().close(tab.key)}>
                                <Icon icon={X} size={12} />
                            </button>
                        </Tooltip>
                    </span>
                );
            })}
        </div>
    );
}
