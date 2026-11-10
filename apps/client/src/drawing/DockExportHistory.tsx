import { ButtonGroup, Icon, IconButton, Menu, type shortcut } from '@adecore/ui';
import { Copy, Download, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { historyAction } from '@/action-port/person-actions';

type ExportFormat = 'png' | 'svg';
type Shortcut = ReturnType<typeof shortcut>;

/* The exports and the way back at the end of a drawing's or a diagram's dock, in the same place and shape. */
export function DockExportHistory({
    viewId,
    empty,
    canUndo,
    canRedo,
    shortcuts,
    onCopy,
    onSave,
    label,
    extra
}: {
    viewId: string | null;
    empty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    shortcuts: { undo: Shortcut; redo: Shortcut };
    onCopy(format: ExportFormat): void;
    onSave(format: ExportFormat): void;
    label?: ReactNode;
    extra?: ReactNode;
}) {
    const { t } = useTranslation('drawing');

    return (
        <ButtonGroup>
            <Menu.Root>
                <IconButton render={<Menu.Trigger />} icon={MoreHorizontal} label={t('export.label')} />
                <Menu.Popup side="top" sideOffset={10} align="end" className="min-w-52">
                    {label !== undefined && <Menu.Label>{label}</Menu.Label>}
                    <Menu.Item disabled={empty} onClick={() => onCopy('png')}>
                        <Icon icon={Copy} size={14} /> {t('export.copyPng')}
                    </Menu.Item>
                    <Menu.Item disabled={empty} onClick={() => onSave('png')}>
                        <Icon icon={Download} size={14} /> {t('export.savePng')}
                    </Menu.Item>
                    <Menu.Item disabled={empty} onClick={() => onCopy('svg')}>
                        <Icon icon={Copy} size={14} /> {t('export.copySvg')}
                    </Menu.Item>
                    <Menu.Item disabled={empty} onClick={() => onSave('svg')}>
                        <Icon icon={Download} size={14} /> {t('export.saveSvg')}
                    </Menu.Item>
                    {extra}
                </Menu.Popup>
            </Menu.Root>
            <IconButton icon={Undo2} label={t('common:action.undo')} kbd={shortcuts.undo} disabled={!canUndo} onClick={() => historyAction('undo', viewId)} />
            <IconButton icon={Redo2} label={t('common:action.redo')} kbd={shortcuts.redo} disabled={!canRedo} onClick={() => historyAction('redo', viewId)} />
        </ButtonGroup>
    );
}
