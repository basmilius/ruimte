import { useState } from 'react';
import type { FsReadText } from '@ruimte/contracts';
import { Markdown } from '@/chat/ui/Markdown';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileScroll } from '@/shell/panels/FileScroll';
import { Segmented } from '@/shell/settings/controls';

type MarkdownView = 'preview' | 'source';

const VIEWS: Array<{ id: MarkdownView; label: string }> = [
    { id: 'preview', label: 'Preview' },
    { id: 'source', label: 'Source' }
];

/*
 * A markdown file the way it is meant to be read, with the source a click away. Both views share one
 * toolbar, so the switch does not move when it is used.
 */
export function MarkdownFile({ name, read }: { name: string; read: FsReadText }) {
    const [view, setView] = useState<MarkdownView>('preview');
    const toggle = <Segmented value={view} options={VIEWS} onChange={(id) => setView(id)} label="How to show this file" />;

    if (view === 'source') {
        return <CodeFile name={name} read={read} toolbarStart={toggle} />;
    }
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="file-toolbar">{toggle}</div>
            <FileScroll className="px-4 py-3">
                <Markdown text={read.text} />
            </FileScroll>
        </div>
    );
}
