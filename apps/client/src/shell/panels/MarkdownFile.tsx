import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Eye } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { Markdown } from '@/chat/ui/Markdown';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileLinkContext } from '@/shell/panels/file-links';
import { FileScroll } from '@/shell/panels/FileScroll';
import { dirnameOf } from '@/shell/panels/files-tree';
import { DisabledWrapToggle, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { BTN_GROUP } from '@/ui/classes';
import { Separator } from '@/ui/Separator';

type MarkdownView = 'preview' | 'source';

/*
 * A markdown file the way it is meant to be read, with the source a click away. Both views share one
 * toolbar, so the switch does not move when it is used.
 */
export function MarkdownFile({ path, name, read }: { path: string; name: string; read: FsReadText }) {
    const { t } = useTranslation('panels');
    const [view, setView] = useState<MarkdownView>('preview');
    const toggle = (
        <div className={BTN_GROUP}>
            <FileToolbarToggle icon={Eye} label={t('file.view.preview')} active={view === 'preview'} onClick={() => setView('preview')} />
            <FileToolbarToggle icon={Code} label={t('file.view.source')} active={view === 'source'} onClick={() => setView('source')} />
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
            {/* Prose is read in the same column the standalone chat view gives a thread, at the
                app's own type. The scroller keeps the panel's full width, so its scrollbar stays at
                the panel's edge; only the text inside it is centered. */}
            <FileScroll className="px-4 py-3">
                <div className="mx-auto max-w-[768px]">
                    {/* A link in a document counts from the folder that document sits in, the way it
                        would on a forge. */}
                    <FileLinkContext.Provider value={dirnameOf(path)}>
                        <Markdown text={read.text} />
                    </FileLinkContext.Provider>
                </div>
            </FileScroll>
        </div>
    );
}
