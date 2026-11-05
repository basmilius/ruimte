import { Icon, Menu } from '@adecore/ui';
import { relativeTo } from '@ruimte/contracts';
import { Columns2, CornerUpRight, Folder, Frame, Globe, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { createNodeAction, createViewAction } from '@/action-port/person-actions';
import { fileInfoOf } from '@/extensions/file-info';
import { SlotMenuItems } from '@/extensions/SlotSurfaces';
import { localFileUrl } from '@/files/file-url';
import { FileCopyRow } from '@/files/FileCopyRow';
import { revealFile } from '@/files/reveal-file';
import { basenameOf } from '@/paths/file-path';
import { showFileOnCanvas } from '@/project/views';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { isHtmlName } from '@/surface/panels/file-kind';
import { revealableInFiles } from '@/surface/panels/files-tree';
import { useTransport } from '@/workspace/context';

/* Where these items are drawn, since a file already there does not offer to go there again: a node is
   not shown on the canvas twice, a view is not opened as one, and the files panel does not reveal a row
   in itself. `list` is any other list that names files, such as the changes of a commit. */
export type FileSurfaceKind = 'tab' | 'node' | 'view' | 'files' | 'list';

interface FileActionItemsProps {
    /* Absolute on the daemon's machine. */
    path: string;
    on: FileSurfaceKind;
    /* Reads the file again; absent where nothing is holding a read to redo. */
    onRefresh?: () => void;
    /* A file a diff names that is no longer on disk: only its name and path can still be copied. */
    gone?: boolean;
}

/*
 * What can be asked of a file wherever it is drawn: a preview tab, a node on the canvas, a view of its
 * own or a row of a list. Nothing here is about a tab, so every surface offers the same things in the
 * same order: where it can stand, then where it is, then copying it.
 */
export function FileActionItems({ path, on, onRefresh, gone = false }: FileActionItemsProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const transport = useTransport();
    const onCanvas = useDocument(hasActiveCanvas);
    const offerShow = on !== 'node' && onCanvas;
    const offerView = on !== 'view';
    const name = basenameOf(path);

    return (
        <>
            {offerShow && (
                <Menu.Item disabled={gone} onClick={() => void showFileOnCanvas(path)}>
                    <Icon icon={Frame} size={14} /> {t('file.menu.showOnCanvas')}
                </Menu.Item>
            )}
            {offerView && (
                <Menu.Item disabled={gone} onClick={() => void createViewAction('file', { path })}>
                    <Icon icon={Columns2} size={14} /> {t('file.menu.openAsView')}
                </Menu.Item>
            )}
            {isHtmlName(name) && (
                <Menu.Item disabled={gone} onClick={() => void createNodeAction('browser', { url: localFileUrl(path) })}>
                    <Icon icon={Globe} size={14} /> {t('file.menu.openInBrowser')}
                </Menu.Item>
            )}
            {on !== 'files' && (
                <Menu.Item disabled={gone || !revealableInFiles(folder, path)} onClick={() => void perform('file.reveal', { path }).catch(ignoreRefusal)}>
                    <Icon icon={Folder} size={14} /> {t('file.menu.revealInFiles')}
                </Menu.Item>
            )}
            <Menu.Item disabled={gone} onClick={() => revealFile(transport, path)}>
                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
            </Menu.Item>
            <Menu.Separator />
            <FileCopyRow targets={[{ absolute: path, relative: folder === null ? null : relativeTo(folder, path), gone }]} />
            <SlotMenuItems kit={Menu} place={on === 'files' ? 'fileMenu' : 'editorMenu'} context={{ file: fileInfoOf(path), files: [fileInfoOf(path)] }} />
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
