import { useTranslation } from 'react-i18next';
import { AtSign, Columns2, Copy, CornerUpRight, Folder, Frame, Globe, RefreshCw } from 'lucide-react';
import { createNodeAction, createViewAction, runAsPerson } from '@/actions/client-actions';
import { showFileOnCanvas } from '@/project/views';
import { isHtmlName } from '@/shell/panels/file-kind';
import { localFileUrl } from '@/shell/panels/file-url';
import { basenameOf, mentionOf, revealableInFiles } from '@/shell/panels/files-tree';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { copyText, Icon, Menu } from '@basmilius/desktop-ui';

/* Which of the three surfaces these items are on, since a file already on one does not offer to go
   there again: a node is not shown on the canvas twice and a view is not opened as one. */
export type FileSurfaceKind = 'tab' | 'node' | 'view';

interface FileActionItemsProps {
    /* Absolute on the daemon's machine. */
    path: string;
    on: FileSurfaceKind;
    /* Reads the file again; absent where nothing is holding a read to redo. */
    onRefresh?: () => void;
}

/*
 * What can be asked of a file wherever it is drawn: a preview tab, a node on the canvas or a view
 * of its own. Nothing here is about a tab, so the three surfaces offer the same things in the same
 * order and only the two that would point at themselves are left out.
 */
export function FileActionItems({ path, on, onRefresh }: FileActionItemsProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const transport = useTransport();
    const onCanvas = useDocument(hasActiveCanvas);
    const offerShow = on !== 'node' && onCanvas;
    const offerView = on !== 'view';
    const name = basenameOf(path);
    const mention = mentionOf(folder, path);

    const openInBrowserNode = (): void => {
        void createNodeAction('browser', { url: localFileUrl(path) });
    };

    return (
        <>
            <Menu.Item disabled={!revealableInFiles(folder, path)} onClick={() => void runAsPerson('file.reveal', { path })}>
                <Icon icon={Folder} size={14} /> {t('file.menu.revealInFiles')}
            </Menu.Item>
            <Menu.Item
                onClick={() => {
                    void transport.request('fs.reveal', { path }).catch(() => undefined);
                }}
            >
                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
            </Menu.Item>
            {isHtmlName(name) && (
                <Menu.Item onClick={openInBrowserNode}>
                    <Icon icon={Globe} size={14} /> {t('file.menu.openInBrowser')}
                </Menu.Item>
            )}
            {(offerShow || offerView) && <Menu.Separator />}
            {offerShow && (
                <Menu.Item onClick={() => void showFileOnCanvas(path)}>
                    <Icon icon={Frame} size={14} /> {t('file.menu.showOnCanvas')}
                </Menu.Item>
            )}
            {offerView && (
                <Menu.Item onClick={() => void createViewAction('file', { path })}>
                    <Icon icon={Columns2} size={14} /> {t('file.menu.openAsView')}
                </Menu.Item>
            )}
            <Menu.Separator />
            <Menu.Item onClick={() => void runAsPerson('file.copyPath', { path, relative: false })}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyPath')}
            </Menu.Item>
            <Menu.Item disabled={folder === null} onClick={() => void runAsPerson('file.copyPath', { path, relative: true })}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyRelativePath')}
            </Menu.Item>
            {mention !== null && (
                <Menu.Item onClick={() => copyText(mention)}>
                    <Icon icon={AtSign} size={14} /> {t('file.menu.copyMention')}
                </Menu.Item>
            )}
            {onRefresh !== undefined && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}
