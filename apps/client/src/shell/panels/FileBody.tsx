import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileWarning, LoaderCircle } from 'lucide-react';
import type { FileSurfaceKind } from '@/shell/panels/FileActionItems';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { renderFile } from '@/shell/panels/renderers';
import { useFileRead } from '@/shell/panels/use-file-read';
import { Button } from '@ruimte/ui/Button';
import { EmptyState } from '@ruimte/ui/EmptyState';

/* The two states no renderer draws still carry the bar, so a file that will not read can be
   revealed, copied or put somewhere else, which is exactly what a path that went missing needs. */
function WithoutRenderer({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <FileTextMenu className="grid min-h-0 grow place-items-center">{children}</FileTextMenu>
        </div>
    );
}

/*
 * One file, read and drawn. The read lives here and not in the renderers, so every surface that
 * shows a file (a preview tab, a node on the canvas, a view of its own) has one loading state and
 * one error state, and a renderer only ever sees a file that is there.
 */
export function FileBody({ path, name, on, tabKey }: { path: string; name: string; on: FileSurfaceKind; tabKey?: string }) {
    const { t } = useTranslation('panels');
    const { state, retry } = useFileRead(path);
    const actions = useMemo(() => ({ path, name, on, tabKey, refresh: retry }), [path, name, on, tabKey, retry]);

    const body = (): ReactNode => {
        if (state.status === 'loading') {
            return (
                <WithoutRenderer>
                    <EmptyState icon={LoaderCircle} spin>
                        {t('file.reading', { name })}
                    </EmptyState>
                </WithoutRenderer>
            );
        }
        if (state.status === 'error') {
            return (
                <WithoutRenderer>
                    <EmptyState
                        className="select-text"
                        icon={FileWarning}
                        action={
                            <Button variant="secondary" size="sm" onClick={retry}>
                                {t('common:action.retry')}
                            </Button>
                        }
                    >
                        {state.message}
                    </EmptyState>
                </WithoutRenderer>
            );
        }
        return renderFile({ path, name, read: state.read });
    };

    return <FileActionsContext.Provider value={actions}>{body()}</FileActionsContext.Provider>;
}
