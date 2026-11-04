import { Button, ScrollArea } from '@adecore/ui';
import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/actions/client-actions';
import { fileInfoOf } from '@/extensions/file-info';
import { useContributions } from '@/extensions/registry';
import { relativeTo } from '@/shell/panels/files-tree';
import type { FileTabView } from '@/state/files';
import { useGitSignal } from '@/state/git-watch';
import { useTransport } from '@/transport/context';

/* A changed file an extension knows how to show, with Ruimte's own diff one click away. It reads the diff that one shows. */
export function ExtensionDiffViewer({ path, view, children }: { path: string; view: FileTabView; children: ReactNode }) {
    const { t } = useTranslation('panels');
    const info = fileInfoOf(path);
    const viewer = useContributions((state) => state.diffViewers.find((each) => each.extensions.includes(info.extension)));
    const transport = useTransport();
    const signal = useGitSignal(viewer === undefined ? null : view.cwd);
    const relative = relativeTo(view.cwd, path);
    const [own, setOwn] = useState(false);
    const [diff, setDiff] = useState('');

    useEffect(() => {
        if (viewer === undefined) {
            return undefined;
        }

        let current = true;

        perform('git.diff', {
            repository: view.cwd,
            path: relative,
            scope: view.scope,
            commit: null,
            staged: view.staged,
            ignoreWhitespace: null,
            base: view.base ?? null
        }).then(
            (answer) => {
                if (current) {
                    setDiff(answer.diff);
                }
            },
            () => undefined
        );

        return () => {
            current = false;
        };
    }, [viewer, transport, signal, relative, view.cwd, view.scope, view.staged, view.base]);

    if (viewer === undefined) {
        return children;
    }

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="flex shrink-0 items-center justify-end gap-2 px-2 py-1">
                <Button variant="ghost" size="sm" onClick={() => setOwn(!own)}>
                    {own ? viewer.title : t('file.viewer.original')}
                </Button>
            </div>
            <ScrollArea axis="both" className="grow" viewportClassName="flex flex-col">
                {own ? children : createElement(viewer.component, { file: info, diff })}
            </ScrollArea>
        </div>
    );
}
