import { EmptyState } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import type { FsReadBinary, FsReadTooLarge } from '@ruimte/contracts';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { RevealButton } from '@/shell/panels/RevealButton';
import { TEXT_MAX_BYTES } from '@/transport/large-text';

/* What is left when there is nothing to draw: what the file is, how large, and the way to open it. */
export function UnsupportedFile({ path, name, read }: { path: string; name: string; read: FsReadBinary | FsReadTooLarge }) {
    const { t } = useTranslation('panels');
    return (
        // The bar as well: everything that can be asked of the file still can be.
        <FileTextMenu className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <EmptyState className="select-text" icon={FileQuestion} action={<RevealButton path={path} />}>
                {read.kind === 'too-large'
                    ? t('file.tooLarge', { name, size: formatBytes(read.size), limit: formatBytes(TEXT_MAX_BYTES) })
                    : t('file.cannotShow', { name, mime: read.mime, size: formatBytes(read.size) })}
            </EmptyState>
        </FileTextMenu>
    );
}
