import { Button, Dialog, FileIcon } from '@adecore/ui';
import { relativeTo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { useProject } from '@/state/project';
import { openLocatedFile, useFileChoice } from '@/surface/panels/file-links';

/* A link an agent wrote that more than one folder of the project holds: the person picks which file it meant. */
export function FileChoiceDialog() {
    const { t } = useTranslation(['panels', 'common']);
    const choice = useFileChoice((s) => s.choice);
    const folder = useProject((s) => s.current?.folder ?? null);
    const close = (): void => useFileChoice.setState({ choice: null });

    return (
        <Dialog.Root open={choice !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('file.choice.title', { path: choice?.ref.path ?? '' })}</Dialog.Title>
                <Dialog.Text className="mt-1">{t('file.choice.description')}</Dialog.Text>
                <ul className="mt-3 flex flex-col gap-1">
                    {choice?.matches.map((path) => (
                        <li key={path}>
                            <Button
                                className="w-full justify-start"
                                onClick={() => {
                                    close();
                                    void openLocatedFile(path, choice.ref, choice.endpointId);
                                }}
                            >
                                <FileIcon path={path} size={14} />
                                <span className="min-w-0 truncate">{folder === null ? path : relativeTo(folder, path)}</span>
                            </Button>
                        </li>
                    ))}
                </ul>
                <Dialog.Footer>
                    <Button onClick={close}>{t('common:action.cancel')}</Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
