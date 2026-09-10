import { useState } from 'react';
import { Code, Eye } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { Markdown } from '@/chat/ui/Markdown';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileScroll } from '@/shell/panels/FileScroll';
import { DisabledWrapToggle, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { Separator } from '@/ui/Separator';

type MarkdownView = 'preview' | 'source';

/*
 * A markdown file the way it is meant to be read, with the source a click away. Both views share one
 * toolbar, so the switch does not move when it is used.
 */
export function MarkdownFile({ name, read }: { name: string; read: FsReadText }) {
    const [view, setView] = useState<MarkdownView>('preview');
    const toggle = (
        <div className="btn-group">
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
            <FileScroll className="px-4 py-3">
                <Markdown text={read.text} />
            </FileScroll>
        </div>
    );
}
