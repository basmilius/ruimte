import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { X } from 'lucide-react';
import { fileGlyph } from '@/shell/panels/file-glyph';
import { basenameOf } from '@/shell/panels/files-tree';
import { renderFile } from '@/shell/panels/renderers';
import { useFiles } from '@/state/files';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The column right of the tree, mounted for as long as a file is open. The tab strip is the same 32
 * pixel band as the tree's tool row, so the two read as one header across the split.
 */
export function FileViewer() {
    const tabs = useFiles((s) => s.tabs);
    const active = useFiles((s) => s.active);
    const stripRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        stripRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    const cycle = (direction: -1 | 1): void => {
        const index = tabs.findIndex((tab) => tab.path === active);
        const next = tabs[(index + direction + tabs.length) % tabs.length];
        if (next) {
            useFiles.getState().activate(next.path);
        }
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'w' && (event.metaKey || event.ctrlKey) && active) {
            event.preventDefault();
            useFiles.getState().close(active);
        } else if (event.key === 'Tab' && event.ctrlKey && tabs.length > 1) {
            event.preventDefault();
            cycle(event.shiftKey ? -1 : 1);
        }
    };

    // A trackpad swipes sideways on its own; a wheel with one axis still has to reach the strip.
    const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
        if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
        }
    };

    const name = active ? basenameOf(active) : '';

    return (
        <div className="flex min-w-0 grow flex-col" onKeyDown={onKeyDown}>
            <div ref={stripRef} className="files-tab-strip" onWheel={onWheel}>
                {tabs.map((tab) => {
                    const label = basenameOf(tab.path);
                    return (
                        <span key={tab.path} className="files-tab" data-active={tab.path === active} data-pinned={tab.pinned}>
                            <button
                                className="files-tab-open"
                                aria-current={tab.path === active}
                                onClick={() => useFiles.getState().activate(tab.path)}
                                onDoubleClick={() => useFiles.getState().setPinned(tab.path, !tab.pinned)}
                            >
                                <Icon icon={fileGlyph(label)} size={12} />
                                <span className="files-tab-name">{label}</span>
                                <span className="files-tab-dot" data-dirty={tab.dirty} />
                            </button>
                            <Tooltip label={`Close ${label}`} kbd="⌘W" name>
                                <button className="files-tab-close" onClick={() => useFiles.getState().close(tab.path)}>
                                    <Icon icon={X} size={12} />
                                </button>
                            </Tooltip>
                        </span>
                    );
                })}
            </div>
            <div className="grid min-h-0 grow place-items-center overflow-auto">{active && renderFile({ path: active, name })}</div>
        </div>
    );
}
