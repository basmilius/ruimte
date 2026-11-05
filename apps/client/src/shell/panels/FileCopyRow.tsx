import { copyText, Icon, Menu, messageOf } from '@adecore/ui';
import { AtSign, ChevronRight, Copy, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { canCopyFilesOn, copiedText, copyableFiles, type CopyTarget, type CopyTextKind } from '@/surface/panels/file-copy';

/*
 * Copy in every menu of a file, a folder or a selection of them. The row copies them as mentions; its
 * chevron opens the rest: the files themselves, for the file manager to paste, and their names and
 * paths. `ContextMenu` draws these parts as its own, so one row serves both kinds of menu.
 */
export function FileCopyRow({ targets }: { targets: readonly CopyTarget[] }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const folder = useProject((s) => s.current?.folder ?? null);
    const files = copyableFiles(targets);
    const many = targets.length > 1;
    const mentionLabel = many ? t('files.copyMentions') : t('file.menu.copyMention');

    const copyFiles = (): void => {
        perform('file.copy', { paths: files }).catch((e: unknown) => {
            useToasts.getState().show({ title: t('file.menu.copyFailed'), description: messageOf(e), kind: 'error' });
        });
    };

    const textItem = (kind: CopyTextKind, label: string, icon: LucideIcon = Copy) => {
        const text = copiedText(folder, targets, kind);
        return (
            <Menu.Item disabled={text === null} onClick={() => text !== null && copyText(text)}>
                <Icon icon={icon} size={14} /> {label}
            </Menu.Item>
        );
    };

    return (
        <Menu.Row aria-label={mentionLabel}>
            {textItem('mention', mentionLabel, AtSign)}
            <Menu.SubmenuRoot>
                <Menu.RowSubmenuTrigger icon={ChevronRight} label={t('file.menu.copyMore')} />
                <Menu.Popup>
                    <Menu.Item disabled={files.length === 0 || !canCopyFilesOn(endpointId)} onClick={copyFiles}>
                        <Icon icon={Copy} size={14} /> {t('file.menu.copy')}
                    </Menu.Item>
                    {textItem('name', many ? t('files.copyNames') : t('files.copyName'))}
                    {textItem('path', many ? t('files.copyPaths') : t('file.menu.copyPath'))}
                    {textItem('relative', many ? t('files.copyRelativePaths') : t('file.menu.copyRelativePath'))}
                </Menu.Popup>
            </Menu.SubmenuRoot>
        </Menu.Row>
    );
}
