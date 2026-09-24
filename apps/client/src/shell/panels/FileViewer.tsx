import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { runAsPerson } from '@/actions/client-actions';
import { FileText, Search } from 'lucide-react';
import { DiffFile } from '@/shell/panels/DiffFile';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { FileBody } from '@/shell/panels/FileBody';
import { FileIcon } from '@/ui/FileIcon';
import { basenameOf } from '@/shell/panels/files-tree';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { SECTION_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Tile } from '@/ui/Tile';

/* The preview with no tab up: a file to open, a search through the folder, and what was closed a moment ago. */
function EmptyPreview() {
    const { t } = useTranslation('panels');
    const folder = useProject((s) => s.current?.folder ?? null);
    const recent = useFiles((s) => s.recent);
    if (folder === null && recent.length === 0) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileText} size={20} />}>{t('file.empty.hint')}</EmptyState>
            </div>
        );
    }
    return (
        <div className="grid min-h-0 grow place-items-center overflow-auto">
            <div className="flex w-full max-w-xs flex-col gap-4 px-4 py-6">
                {folder !== null && (
                    <div className="flex flex-col gap-1.5">
                        <Tile
                            size="sm"
                            icon={<Icon icon={FileText} size={14} />}
                            title={t('file.empty.openFile')}
                            onClick={() => useUi.getState().openFilePicker({ kind: 'tab' })}
                        />
                        <Tile
                            size="sm"
                            icon={<Icon icon={Search} size={14} />}
                            title={t('file.empty.findInFiles')}
                            shortcut={APP_SHORTCUTS.findInFiles}
                            onClick={() => useUi.getState().openFindInFiles()}
                        />
                    </div>
                )}
                {recent.length > 0 && (
                    <section className="flex flex-col gap-1">
                        <h2 className={`${SECTION_LABEL} px-2`}>{t('file.empty.recent')}</h2>
                        {recent.map((path) => (
                            <ContextMenu.Root key={path}>
                                <ContextMenu.Trigger
                                    render={<button type="button" />}
                                    className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-text hover:bg-surface-hover"
                                    onClick={() => void runAsPerson('file.preview', { path, line: null })}
                                >
                                    <FileIcon path={path} size={14} />
                                    <span className="min-w-0 truncate">{basenameOf(path)}</span>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Positioner className="z-(--z-popup)">
                                        {/* Closed, so no tab to name: the items a preview tab offers about its file. */}
                                        <ContextMenu.Popup className="menu-popup">
                                            <FileActionItems path={path} on="tab" />
                                        </ContextMenu.Popup>
                                    </ContextMenu.Positioner>
                                </ContextMenu.Portal>
                            </ContextMenu.Root>
                        ))}
                    </section>
                )}
            </div>
        </div>
    );
}

/* The preview panel's body: whichever tab is up, under the strip that names them. */
export function FileViewer() {
    const active = useFiles((s) => s.active);
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === s.active) ?? null);

    if (!active || !tab) {
        return <EmptyPreview />;
    }

    return (
        // Keyed on the tab, so switching tabs starts a read of its own instead of drawing the file before it.
        <div className="flex min-h-0 min-w-0 grow flex-col justify-center">
            {tab.view ? (
                <DiffFile key={tab.key} tabKey={tab.key} path={tab.path} name={basenameOf(tab.path)} view={tab.view} />
            ) : (
                <FileBody key={tab.key} path={tab.path} name={basenameOf(tab.path)} on="tab" tabKey={tab.key} />
            )}
        </div>
    );
}
