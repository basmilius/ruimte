import { Button, Icon } from '@adecore/ui';
import { CornerUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { revealFile } from '@/shell/panels/reveal-file';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';

/* The way out of a file a renderer cannot draw: the machine's file manager, open on it. */
export function RevealButton({ path }: { path: string }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const transport = useTransport();

    return (
        <Button variant="secondary" size="sm" onClick={() => revealFile(transport, path)}>
            <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
        </Button>
    );
}
