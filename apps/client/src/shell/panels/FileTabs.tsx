import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from 'react';
import { X } from 'lucide-react';
import { fileGlyph } from '@/shell/panels/file-glyph';
import { basenameOf } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The open files as a strip of tabs, inside the preview panel's own header. A tab that is not
 * pinned reads as a preview the way an editor draws one, and a double-click is what pins it.
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
    );
}
