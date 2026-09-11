import { CornerUpRight, FileQuestion } from 'lucide-react';
import { FS_READ_MAX_TEXT_BYTES, type FsReadBinary, type FsReadTooLarge } from '@ruimte/contracts';
import { formatBytes } from '@/shell/panels/file-size';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* What is left when there is nothing to draw: what the file is, how large, and the way to open it. */
export function UnsupportedFile({ path, name, read }: { path: string; name: string; read: FsReadBinary | FsReadTooLarge }) {
    const platform = useServer((s) => s.platform);
    const transport = useTransport();
    const reveal = (): void => {
        void transport.request('fs.reveal', { path }).catch(() => undefined);
    };
    return (
        <EmptyState
            className="select-text"
            icon={<Icon icon={FileQuestion} size={20} />}
            action={
                <Button variant="secondary" size="sm" onClick={reveal}>
                    <Icon icon={CornerUpRight} size={14} /> Reveal in {fileManagerName(platform)}
                </Button>
            }
        >
            {read.kind === 'too-large'
                ? `${name} is ${formatBytes(read.size)}, past the ${formatBytes(FS_READ_MAX_TEXT_BYTES)} the viewer reads.`
                : `${name} is ${formatBytes(read.size)} of ${read.mime}, which the viewer cannot draw.`}
        </EmptyState>
    );
}
