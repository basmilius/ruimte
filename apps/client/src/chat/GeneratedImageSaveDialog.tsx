import { useRef, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, FormError, Input } from '@adecore/ui';

/*
 * Where a generated image lands in the project. Only what it shows: the host owns the folders,
 * the name it checks and the write. A name that is taken never saves over the file through Save
 * or Enter, only through Replace.
 */
export function GeneratedImageSaveDialog({
    open,
    onOpenChange,
    projectName,
    folderTree,
    fileName,
    onFileNameChange,
    destinationPath,
    pending,
    error,
    exists,
    canSave,
    onSave,
    onReplace
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
    projectName: string;
    folderTree: ReactNode;
    fileName: string;
    onFileNameChange(name: string): void;
    destinationPath: string;
    pending: boolean;
    error: string | null;
    exists: boolean;
    canSave: boolean;
    onSave(): void;
    onReplace(): void;
}) {
    const { t } = useTranslation('chat');
    const { t: common } = useTranslation();
    const nameRef = useRef<HTMLInputElement>(null);
    const saveDisabled = pending || exists || !canSave;

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!saveDisabled) {
            onSave();
        }
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next && pending) {
                    return;
                }
                onOpenChange(next);
            }}
        >
            {/* Opened from the lightbox as well, over which an app-level dialog stacks by itself. */}
            <Dialog.Popup size="sm" initialFocus={nameRef}>
                <Dialog.Title>{t('generatedImage.saveTitle')}</Dialog.Title>
                <Dialog.Description className="mt-1">{t('generatedImage.saveIn', { project: projectName })}</Dialog.Description>
                <form onSubmit={submit} aria-busy={pending || undefined}>
                    <fieldset disabled={pending} className="mt-4 flex flex-col gap-4">
                        <Field label={t('generatedImage.folder')} group>
                            <div className="max-h-56 overflow-auto rounded-md border border-border">{folderTree}</div>
                        </Field>
                        <Field
                            label={t('generatedImage.name')}
                            hint={<span className="break-all font-mono">{destinationPath}</span>}
                            error={exists ? t('generatedImage.exists', { name: fileName }) : null}
                        >
                            <Input
                                ref={nameRef}
                                value={fileName}
                                onChange={(event) => onFileNameChange(event.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </Field>
                    </fieldset>
                    {error !== null && <FormError className="mt-3">{error}</FormError>}
                    <Dialog.Footer>
                        <Button disabled={pending} onClick={() => onOpenChange(false)}>
                            {common('action.cancel')}
                        </Button>
                        {exists && (
                            <Button variant="danger-outline" disabled={pending} onClick={onReplace}>
                                {t('generatedImage.replace')}
                            </Button>
                        )}
                        <Button type="submit" variant="primary" disabled={saveDisabled}>
                            {common('action.save')}
                        </Button>
                    </Dialog.Footer>
                </form>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
