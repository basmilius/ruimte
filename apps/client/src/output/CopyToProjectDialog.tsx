import { Button, Dialog, Field, FormError, Icon, Input, messageOf } from '@adecore/ui';
import type { Artifact, ArtifactVersion } from '@ruimte/contracts';
import { TriangleAlert } from 'lucide-react';
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { validImageFileName } from '@/chat/image-save';
import { suggestedCopyName } from '@/output/artifact-list';
import { ProjectFolderPicker } from '@/shell/panels/ProjectFolderPicker';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { TransportError } from '@/transport-api/transport';

/*
 * One opening of the dialog. It stays after a close, so the dialog keeps what it showed while it
 * fades out, and `round` starts the form afresh at the next opening.
 */
export interface CopyToProjectRequest {
    version: ArtifactVersion;
    open: boolean;
    round: number;
}

/*
 * Copies one version into a folder of the window's project. The machine refuses a name that is taken
 * and a link on the way, and the refusal stays beside the name: Ruimte never overwrites a file.
 */
export function CopyToProjectDialog({
    endpointId,
    artifact,
    request,
    onClose
}: {
    endpointId: string;
    artifact: Artifact;
    request: CopyToProjectRequest | null;
    onClose(): void;
}) {
    const nameRef = useRef<HTMLInputElement>(null);
    const [pendingRound, setPendingRound] = useState<number | null>(null);
    const pending = request !== null && pendingRound === request.round;
    return (
        <Dialog.Root
            open={request?.open === true}
            onOpenChange={(open) => {
                if (!open && !pending) {
                    onClose();
                }
            }}
        >
            <Dialog.Popup size="sm" initialFocus={nameRef}>
                {request !== null && (
                    <CopyForm
                        key={request.round}
                        endpointId={endpointId}
                        artifact={artifact}
                        version={request.version}
                        nameRef={nameRef}
                        pending={pending}
                        onPending={(busy) => setPendingRound(busy ? request.round : null)}
                        onClose={onClose}
                    />
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function CopyForm({
    endpointId,
    artifact,
    version,
    nameRef,
    pending,
    onPending,
    onClose
}: {
    endpointId: string;
    artifact: Artifact;
    version: ArtifactVersion;
    nameRef: RefObject<HTMLInputElement | null>;
    pending: boolean;
    onPending(pending: boolean): void;
    onClose(): void;
}) {
    const { t } = useTranslation('output');
    const { t: common } = useTranslation();
    const project = useProject((s) => s.current);
    const [directory, setDirectory] = useState('');
    const [name, setName] = useState(() => suggestedCopyName(artifact, version));
    const [exists, setExists] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const path = directory === '' ? name.trim() : `${directory}/${name.trim()}`;
    const valid = validImageFileName(name.trim());
    const several = version.files.length > 1;

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (project === null || !valid || pending) {
            return;
        }
        onPending(true);
        setError(null);
        setExists(null);
        machineTransport(endpointId)
            .request('artifact.copyToProject', { artifactId: artifact.artifactId, versionId: version.versionId, projectId: project.projectId, path })
            .then(() => {
                useToasts.getState().show({ kind: 'success', title: t('copy.copied', { path }) });
                onPending(false);
                onClose();
            })
            .catch((failure: unknown) => {
                onPending(false);
                if (failure instanceof TransportError && failure.code === 'exists') {
                    setExists(path);
                    return;
                }
                setError(messageOf(failure));
            });
    };

    return (
        <>
            <Dialog.Title>{t('copy.title')}</Dialog.Title>
            <Dialog.Description className="mt-1">{t('copy.description', { project: project?.name ?? '' })}</Dialog.Description>
            <form onSubmit={submit} aria-busy={pending || undefined}>
                <fieldset disabled={pending} className="mt-4 flex flex-col gap-4">
                    {project !== null && (
                        <Field label={t('copy.folder')} group>
                            <div className="overflow-hidden rounded-md border border-border">
                                <ProjectFolderPicker
                                    root={project.folder}
                                    transport={machineTransport(endpointId)}
                                    label={t('copy.folder')}
                                    onSelect={(next) => {
                                        setDirectory(next);
                                        setExists(null);
                                    }}
                                    onError={setError}
                                />
                            </div>
                        </Field>
                    )}
                    <Field
                        label={several ? t('copy.folderName') : t('copy.name')}
                        hint={several ? t('copy.several', { count: version.files.length }) : <span className="font-mono break-all">{path}</span>}
                        error={valid ? null : t('copy.invalidName')}
                    >
                        <Input
                            ref={nameRef}
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                                setExists(null);
                            }}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>
                    {exists !== null && (
                        <p role="alert" className="flex gap-2 text-sm text-status-error">
                            <Icon icon={TriangleAlert} size={14} className="mt-0.5 shrink-0" />
                            <span className="break-all">{t('copy.exists', { path: exists })}</span>
                        </p>
                    )}
                </fieldset>
                {error !== null && <FormError className="mt-3">{error}</FormError>}
                <Dialog.Footer>
                    <Button disabled={pending} onClick={onClose}>
                        {common('action.cancel')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={pending || !valid || project === null || exists !== null}>
                        {t('copy.copy')}
                    </Button>
                </Dialog.Footer>
            </form>
        </>
    );
}
