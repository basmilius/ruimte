import { ErrorBoundary, Icon } from '@adecore/ui';
import type { ArtifactFile } from '@ruimte/contracts';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeText } from '@/files/CodeFile';
import { FileActionsContext } from '@/files/file-actions';
import { FileMarkdown } from '@/files/FileMarkdown';
import { PdfPreview } from '@/files/PdfPreview';
import { useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { useOpenArtifact } from '@/output/artifact-opener';
import { ArtifactPage } from '@/output/ArtifactFileBody';
import { artifactBinaryRead, artifactSource, languageOfName } from '@/output/file-view';
import type { SavedPreviewOf } from '@/output/saved-preview';
import type { Saved } from '@/output/SavedCard';
import { FileToolbarSlotProvider, fixedSlot } from '@/surface/panels/file-toolbar-slot';
import { useMachineUrl } from '@/transport/machine-url';

const MAX_IMAGES = 4;

// A renderer in a thread draws its own bar, never into a bar of the view the chat sits in.
const OWN_BAR = fixedSlot(null);

/* A folded report fades out at the bottom instead of cutting a line in half, the way a long prompt folds. */
const FOLD = '[mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

export function SavedPreview({ endpointId, entry, preview }: { endpointId: string; entry: Saved; preview: SavedPreviewOf }) {
    const { t } = useTranslation('output');
    const reference = refOf(entry, preview.file);
    const file = entry.version.files[preview.file]!;
    return (
        <ErrorBoundary label={t('view.failed')} resetKeys={[entry.version.versionId]} compact className="mt-1 mb-2">
            <FileToolbarSlotProvider value={OWN_BAR}>
                <FileActionsContext.Provider value={null}>
                    {(preview.view === 'markdown' || preview.view === 'code') && (
                        <TextPreview endpointId={endpointId} entry={entry} reference={reference} file={file} markdown={preview.view === 'markdown'} />
                    )}
                    {preview.view === 'image' && <ImagesPreview endpointId={endpointId} entry={entry} />}
                    {preview.view === 'page' && (
                        <ArtifactPage
                            endpointId={endpointId}
                            reference={reference}
                            file={file}
                            title={entry.artifact.title}
                            createdAt={entry.version.createdAt}
                            auto
                        />
                    )}
                    {preview.view === 'pdf' && <PdfPreviewInline endpointId={endpointId} entry={entry} reference={reference} file={file} />}
                </FileActionsContext.Provider>
            </FileToolbarSlotProvider>
        </ErrorBoundary>
    );
}

function refOf(entry: Saved, file: number): ArtifactFileRef {
    return { artifactId: entry.artifact.artifactId, versionId: entry.version.versionId, file };
}

function ShowAll({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const { t } = useTranslation('output');
    return (
        <button type="button" aria-expanded={open} className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text" onClick={onToggle}>
            <Icon icon={ChevronDown} size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? t('card.showLess') : t('card.showAll')}
        </button>
    );
}

function TextPreview({
    endpointId,
    entry,
    reference,
    file,
    markdown
}: {
    endpointId: string;
    entry: Saved;
    reference: ArtifactFileRef;
    file: ArtifactFile;
    markdown: boolean;
}) {
    const text = useArtifactText(endpointId, reference, file);
    const [open, setOpen] = useState(false);
    const [long, setLong] = useState(false);

    const measure = (node: HTMLDivElement | null) => {
        if (node === null) {
            return;
        }
        const check = () => {
            if (node.scrollHeight > node.clientHeight + 1) {
                setLong(true);
            }
        };
        check();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(check);
        observer.observe(node);
        if (node.firstElementChild !== null) {
            observer.observe(node.firstElementChild);
        }
        return () => observer.disconnect();
    };

    // A file that cannot be read stays the row above, which opens it in Output.
    if (text.status !== 'ready') {
        return null;
    }
    const body: ReactNode = markdown ? <FileMarkdown text={text.text} /> : <CodeText text={text.text} language={languageOfName(file.name)} />;
    return (
        <div className="flex flex-col items-start">
            <div
                ref={measure}
                aria-label={entry.artifact.title}
                role="group"
                className={`w-full rounded-lg border border-border bg-clip-padding text-sm select-text ${markdown ? 'px-4 py-3' : 'py-1'} ${open ? '' : 'max-h-80 overflow-hidden'} ${long && !open ? FOLD : ''}`}
            >
                {body}
            </div>
            {long && <ShowAll open={open} onToggle={() => setOpen(!open)} />}
        </div>
    );
}

/* pdf.js scrolls its own pages, so folded is a shorter window on them and Show all a taller one. */
function PdfPreviewInline({ endpointId, entry, reference, file }: { endpointId: string; entry: Saved; reference: ArtifactFileRef; file: ArtifactFile }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="flex flex-col items-start">
            <div
                aria-label={entry.artifact.title}
                role="group"
                className={`flex w-full flex-col overflow-hidden rounded-lg border border-border bg-clip-padding ${open ? 'h-[720px]' : 'h-80'}`}
            >
                <PdfPreview source={artifactSource(endpointId, reference)} name={file.name} read={artifactBinaryRead(file, entry.version.createdAt)} />
            </div>
            <ShowAll open={open} onToggle={() => setOpen(!open)} />
        </div>
    );
}

function ImagesPreview({ endpointId, entry }: { endpointId: string; entry: Saved }) {
    const images = entry.version.files
        .map((file, index) => ({ file, index }))
        .filter(({ file }) => file.mime.startsWith('image/'))
        .slice(0, MAX_IMAGES);
    return (
        <div className="flex flex-wrap gap-2">
            {images.map(({ file, index }) => (
                <SavedImage key={index} endpointId={endpointId} entry={entry} reference={refOf(entry, index)} file={file} />
            ))}
        </div>
    );
}

function SavedImage({ endpointId, entry, reference, file }: { endpointId: string; entry: Saved; reference: ArtifactFileRef; file: ArtifactFile }) {
    const bytes = useMachineUrl({ kind: 'artifact', ...reference }, endpointId);
    const open = useOpenArtifact();
    if (bytes.url === null) {
        return null;
    }
    return (
        <button
            type="button"
            className="overflow-hidden rounded-lg"
            onClick={() => open(entry.artifact.artifactId, entry.artifact.title, entry.latest ? null : entry.version.versionId, entry.version.versionId)}
        >
            <img src={bytes.url} alt={file.name} className="block max-h-80 max-w-full object-contain" />
        </button>
    );
}
