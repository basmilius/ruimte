import { useTranslation } from 'react-i18next';
import { CornerUpRight, FileQuestion } from 'lucide-react';
import { FS_READ_MAX_TEXT_BYTES, type FsReadBinary, type FsReadTooLarge } from '@ruimte/contracts';
import { formatBytes } from '@/shell/panels/file-size';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { Button } from '@ruimte/ui/Button';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { Icon } from '@ruimte/ui/Icon';

/* What is left when there is nothing to draw: what the file is, how large, and the way to open it. */
export function UnsupportedFile({ path, name, read }: { path: string; name: string; read: FsReadBinary | FsReadTooLarge }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const transport = useTransport();
    const reveal = (): void => {
        void transport.request('fs.reveal', { path }).catch(() => undefined);
    };
    return (
        // The bar as well: there is nothing to draw, but everything that can be asked of the file
        // still can be, and its surface keeps a row where every other file has one.
        <FileTextMenu className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <EmptyState
                className="select-text"
                icon={FileQuestion}
                action={
                    <Button variant="secondary" size="sm" onClick={reveal}>
                        <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                    </Button>
                }
            >
                {read.kind === 'too-large'
                    ? t('file.tooLarge', { name, size: formatBytes(read.size), limit: formatBytes(FS_READ_MAX_TEXT_BYTES) })
                    : t('file.cannotShow', { name, mime: read.mime, size: formatBytes(read.size) })}
            </EmptyState>
        </FileTextMenu>
    );
}
