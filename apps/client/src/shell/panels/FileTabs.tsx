import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from 'react';
import { X } from 'lucide-react';
import { basenameOf } from '@/shell/panels/files-tree';
import { useFiles, type FileTabView } from '@/state/files';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* What a diff tab is of the file it names: the index, the base branch, or the working tree. */
const viewLabel = (view: FileTabView): string => (view.staged ? 'staged' : view.scope === 'base' ? 'base' : 'diff');

/*
 * The open files as a strip of tabs, inside the preview panel's own header. A tab that is not
 * pinned reads as a preview the way an editor draws one, and a double-click is what pins it.
 * Changes share one tab: the strip keeps the file's name so it stays readable, with the mark that
 * says this is a diff and not the file.
 */
export function FileTabs() {
    const tabs = useFiles((s) => s.tabs);
    const active = useFiles((s) => s.active);
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
                const label = basenameOf(tab.path);
                return (
                    <span
                        key={tab.key}
                        className="files-tab"
                        data-active={tab.key === active}
                        data-pinned={tab.pinned}
                        data-view={tab.view ? 'diff' : undefined}
                    >
                        <button
                            className="files-tab-open"
                            aria-current={tab.key === active}
                            onClick={() => useFiles.getState().activate(tab.key)}
                            onDoubleClick={() => useFiles.getState().setPinned(tab.key, !tab.pinned)}
                        >
                            <FileIcon path={tab.path} size={14} />
                            <span className="files-tab-name">{label}</span>
                            {tab.view && <Pill className="shrink-0 px-1.5 py-0">{viewLabel(tab.view)}</Pill>}
                            <span className="files-tab-dot" data-dirty={tab.dirty} />
                        </button>
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
