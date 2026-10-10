import { revealFile } from './reveal-file';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, FileQuestion } from 'lucide-react';
import type { FsReadBinary, FsReadTooLarge } from '@ruimte/contracts';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { textLimitFor } from '@/shell/panels/large-text';
import { useEndpointId } from '@/state/keys';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { Button, EmptyState, Icon } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';

/* What is left when there is nothing to draw: what the file is, how large, and the way to open it. */
export function UnsupportedFile({ path, name, read }: { path: string; name: string; read: FsReadBinary | FsReadTooLarge }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const reveal = (): void => {
        revealFile(transport, path);
    };
    return (
        // The bar as well: everything that can be asked of the file still can be.
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
                    ? t('file.tooLarge', { name, size: formatBytes(read.size), limit: formatBytes(textLimitFor(endpointId, read)) })
                    : t('file.cannotShow', { name, mime: read.mime, size: formatBytes(read.size) })}
            </EmptyState>
        </FileTextMenu>
    );
}
