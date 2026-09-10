import { useState } from 'react';
import { Code, Eye } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { Markdown } from '@/chat/ui/Markdown';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileScroll } from '@/shell/panels/FileScroll';
import { DisabledWrapToggle, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { BTN_GROUP } from '@/ui/classes';
import { Separator } from '@/ui/Separator';

type MarkdownView = 'preview' | 'source';

/*
 * A markdown file the way it is meant to be read, with the source a click away. Both views share one
 * toolbar, so the switch does not move when it is used.
 */
export function MarkdownFile({ name, read }: { name: string; read: FsReadText }) {
    const [view, setView] = useState<MarkdownView>('preview');
    const toggle = (
        <div className={BTN_GROUP}>
            <FileToolbarToggle icon={Eye} label="Preview" active={view === 'preview'} onClick={() => setView('preview')} />
            <FileToolbarToggle icon={Code} label="Source" active={view === 'source'} onClick={() => setView('source')} />
        </div>
    );

    if (view === 'source') {
        return <CodeFile name={name} read={read} toolbarExtra={toggle} />;
    }
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                {toggle}
                <Separator />
                <DisabledWrapToggle />
            </FileToolbar>
            {/* Prose is read at the size the standalone chat view reads it at, 15px over 24px, in a
                column of the same width. The scroller keeps the panel's full width, so its scrollbar
                stays at the panel's edge; only the text inside it is centered. Code keeps
                `--text-code`, which the override does not touch. */}
            <FileScroll className="px-4 py-3 [--text-sm:15px] [--text-sm--line-height:24px]">
                <div className="mx-auto max-w-[768px]">
                    <Markdown text={read.text} />
                </div>
            </FileScroll>
        </div>
    );
}
