import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, ExternalLink } from 'lucide-react';
import { fileManagerName, useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';

/* A project's folder, from any row that names the project: reveal it on its machine, or take the path along. */
export function FolderMenuItems({ endpointId, folder, connected }: { endpointId: string; folder: string; connected: boolean }) {
    const { t } = useTranslation('shell');
    const platform = useServers((s) => s.byEndpoint[endpointId]?.platform ?? null);
    const reveal = (): void => {
        void transportFor(endpointId)
            ?.request('fs.reveal', { path: folder })
            .catch(() => undefined);
    };
    return (
        <>
            <ContextMenu.Item className="menu-item" disabled={!connected} onClick={reveal}>
                <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(platform) })}
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item" onClick={() => copyText(folder)}>
                <Icon icon={Copy} size={14} /> {t('start.copyFolder')}
            </ContextMenu.Item>
        </>
    );
}
