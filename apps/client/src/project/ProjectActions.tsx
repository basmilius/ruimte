import { copyText, Icon, Menu } from '@adecore/ui';
import { AppWindow, Copy, ExternalLink, Settings2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectMenuRow } from '@/clients/project/list';
import { canOpenWindows, moveToNewWindow, openInNewWindow } from '@/project/windows';
import { fileManagerName } from '@/state/server';
import { fireAndForget } from '@/transport-api/transport';
import { transportFor } from '@/transport/index';

/*
 * What a row offers for its window and its folder; a recent project offers only these. The Chats
 * project names no folder a person reads, so it offers its window alone.
 */
export function ProjectPlaceActions({ row, platform, current }: { row: ProjectMenuRow; platform: string | null; current: boolean }) {
    const { t } = useTranslation('shell');
    const { summary } = row;
    const folder = summary.scratch === true ? null : summary.folder || null;

    const reveal = async (): Promise<void> => {
        if (folder === null) {
            return;
        }
        await fireAndForget('fs.reveal', transportFor(row.endpointId)?.request('fs.reveal', { path: folder }));
    };

    return (
        <>
            {canOpenWindows() && (
                <Menu.Item
                    disabled={!current && !summary.available}
                    onClick={() => (current ? void moveToNewWindow() : openInNewWindow(row.endpointId, summary.projectId))}
                >
                    <Icon icon={AppWindow} size={14} /> {t(current ? 'projectMenu.moveToNewWindow' : 'projectMenu.openInNewWindow')}
                </Menu.Item>
            )}
            {folder !== null && (
                <>
                    <Menu.Item disabled={!row.connected} onClick={() => void reveal()}>
                        <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(platform) })}
                    </Menu.Item>
                    <Menu.Item onClick={() => copyText(folder)}>
                        <Icon icon={Copy} size={14} /> {t('projectMenu.copyPath')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}

/*
 * One menu for a project wherever it is named: its tab, its heading in the sidebar and the switcher.
 * `leading` holds what only one of those places offers, such as the pin of a tab.
 */
export function ProjectActions({
    row,
    platform,
    current,
    leading,
    onSettings,
    onClose
}: {
    row: ProjectMenuRow;
    platform: string | null;
    current: boolean;
    leading?: ReactNode;
    onSettings?(): void;
    onClose?(): void;
}) {
    const { t } = useTranslation('shell');

    return (
        <>
            {leading !== undefined && (
                <>
                    {leading}
                    <Menu.Separator />
                </>
            )}
            <ProjectPlaceActions row={row} platform={platform} current={current} />
            {onSettings !== undefined && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={onSettings}>
                        <Icon icon={Settings2} size={14} /> {t('projectMenu.projectSettings')}
                    </Menu.Item>
                </>
            )}
            {onClose !== undefined && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={onClose}>
                        <Icon icon={X} size={14} /> {t('projectMenu.closeProject')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}
