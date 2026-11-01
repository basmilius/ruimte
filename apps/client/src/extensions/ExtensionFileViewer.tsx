import { createElement, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { fileInfoOf } from '@/extensions/file-info';
import { useContributions } from '@/extensions/registry';

/* A file an extension knows, in its view, with Ruimte's own one click away so a broken viewer costs nobody the file. */
export function ExtensionFileViewer({ path, name, text, children }: { path: string; name: string; text: string | null; children: ReactNode }) {
    const { t } = useTranslation('panels');
    const info = fileInfoOf(path);
    const viewer = useContributions((state) => state.fileViewers.find((each) => each.extensions.includes(info.extension)));
    const [own, setOwn] = useState(false);

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
            <div className="flex min-h-0 min-w-0 grow flex-col overflow-auto">
                {own ? children : createElement(viewer.component, { file: { ...info, name, text } })}
            </div>
        </div>
    );
}
