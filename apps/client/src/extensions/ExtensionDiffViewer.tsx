import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { fileInfoOf } from '@/extensions/file-info';
import { useContributions } from '@/extensions/registry';
import { useTransport } from '@/transport/context';

/* A changed file an extension knows how to show, with Ruimte's own diff one click away. */
export function ExtensionDiffViewer({ path, cwd, children }: { path: string; cwd: string; children: ReactNode }) {
    const { t } = useTranslation('panels');
    const info = fileInfoOf(path);
    const viewer = useContributions((state) => state.diffViewers.find((each) => each.extensions.includes(info.extension)));
    const transport = useTransport();
    const [own, setOwn] = useState(false);
    const [diff, setDiff] = useState('');

    useEffect(() => {
        if (viewer === undefined) {
            return undefined;
        }

        let current = true;

        void transport.request('git.diff', { cwd, path, scope: 'worktree' }).then(
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
    }, [viewer, transport, cwd, path]);

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
            <div className="flex min-h-0 min-w-0 grow flex-col overflow-auto">{own ? children : createElement(viewer.component, { file: info, diff })}</div>
        </div>
    );
}
