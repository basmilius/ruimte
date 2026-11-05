import { FileLinkContext } from '@adecore/agents-react/chat/ui';
import type { FsReadText } from '@ruimte/contracts';
import { Eye } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FindBar } from '@/find/FindBar';
import { FindMarks } from '@/find/FindMarks';
import { useDomFind } from '@/find/use-dom-find';
import { useFind } from '@/find/use-find';
import { dirnameOf } from '@/paths/file-path';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileMarkdown } from '@/shell/panels/FileMarkdown';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar } from '@/shell/panels/FileToolbar';
import { useSourceToggle } from '@/shell/panels/use-source-toggle';

/*
 * A markdown file the way it is meant to be read, with the source a click away and editable. Both
 * views share one toolbar, so the switch does not move when it is used.
 */
export function MarkdownFile({ path, read }: { path: string; read: FsReadText }) {
    const { t } = useTranslation('panels');
    const { source, toggle } = useSourceToggle(path, Eye, { label: t('file.view.preview'), afterSave: t('file.view.previewAfterSave') });
    const surface = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    // The source is the editor's to search; this one is the text the preview draws.
    const find = useFind(surface, !source);
    const domFind = useDomFind(find, content);

    if (source) {
        return <CodeFile path={path} read={read} toolbarExtra={toggle} />;
    }
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>{toggle}</FileToolbar>
            {/* Prose gets the column a chat view gives a thread; the scroller keeps the full width, so its scrollbar stays at the edge. */}
            <div ref={surface} className="relative flex min-h-0 min-w-0 grow flex-col">
                {find.open && <FindBar find={find} total={domFind.total} current={domFind.current} invalid={domFind.invalid} onStep={domFind.step} />}
                <FileScroll className="px-4 py-3">
                    <div ref={content} className="mx-auto max-w-[768px]">
                        {/* A link in a document counts from the folder that document sits in, the way it would on a forge. */}
                        <FileLinkContext.Provider value={dirnameOf(path)}>
                            <FileMarkdown text={read.text} />
                        </FileLinkContext.Provider>
                    </div>
                </FileScroll>
                {find.open && <FindMarks marks={domFind.marks} current={domFind.currentMark} />}
            </div>
        </div>
    );
}
