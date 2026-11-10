import {
    Button,
    ChoiceCards,
    Dialog,
    ErrorBoundary,
    FieldHint,
    FormError,
    Icon,
    Input,
    Segmented,
    Select,
    Skeleton,
    Switch,
    type Choice,
    messageOf
} from '@adecore/ui';
import { formatMoment } from '@adecore/ui/format';
import { ActionRefusal } from '@ruimte/actions';
import type { ChatMoveInfoResult, ChatMoveRefusal, ProjectSummary } from '@ruimte/contracts';
import { AtSign, Folder, FolderInput, FolderOpen, FolderPlus, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { desktop } from '@/desktop/bridge';
import type { MoveChatRequest } from '@/project/dialogs';
import { moveChatDialog } from '@/project/dialogs';
import {
    baseName,
    defaultOwnFiles,
    folderSlug,
    joinFolder,
    MAX_WORKED_CARDS,
    moveTargetOf,
    NEW_PROJECT,
    workedCard,
    type FolderChoice,
    type MoveForm
} from '@/project/move-chat-form';
import { moveCandidatesOf } from '@/project/move-targets';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useEndpointId } from '@/state/current-endpoint';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useViewNodes } from '@/state/view-nodes';
import { useTransport } from '@/workspace/context';

type OwnFiles = 'move' | 'leave';

/* The folder a project of this name gets under `parent`; empty for a name that makes no folder name, which asks for a full path. */
function newFolderOf(parent: string, name: string): string {
    const slug = folderSlug(name);
    return slug === '' ? '' : joinFolder(parent, slug);
}

/* Answers of the machine that mean the picture in the dialog is old, so it is asked again. */
const STALE_CODES: readonly string[] = ['move-refused', 'chat-busy', 'files-conflict'];

/*
 * Makes a project of a chat in Chats, or moves it into one that is there. One dialog for both: the
 * machine says where the chat worked, what it left in its own folder and whether it can move at all,
 * and the person picks the project or the folder. Nothing moves until the machine has answered.
 */
export function MoveChatDialog() {
    const { t } = useTranslation('project');
    const request = moveChatDialog.useRequest((request) => request);
    const close = (): void => moveChatDialog.set(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                <ErrorBoundary label={t('moveChat.failedToRender')} resetKeys={[request?.chatId]}>
                    {request !== null && <MoveChatForm key={request.chatId} request={request} onDone={close} />}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function MoveChatForm({ request, onDone }: { request: MoveChatRequest; onDone(): void }) {
    const { t } = useTranslation('project');
    const endpointId = useEndpointId();
    const transport = useTransport();
    const chatName = useViewNodes((views) => views.find((view) => view.id === request.chatId)?.name ?? '');
    const rows = useProjectList((s) => s.projects);
    const endpoints = useEndpoints((s) => s.endpoints);
    const projects = moveCandidatesOf(rows, endpoints, endpointId);

    const asksProject = request.mode === 'pick' && request.projectId === null;
    const [typed, setTyped] = useState<MoveForm>({
        destination: request.mode === 'make' ? NEW_PROJECT : request.projectId,
        folder: 'new',
        name: request.suggest?.name ?? chatName,
        newPath: request.suggest?.folder ?? '',
        initGit: true,
        chosenPath: ''
    });
    // A folder an agent suggested stands as typed, so the name does not rewrite it.
    const [pathEdited, setPathEdited] = useState(request.suggest?.folder !== undefined);
    const [ownFiles, setOwnFiles] = useState<OwnFiles | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const [info, setInfo] = useState<ChatMoveInfoResult | null>(null);
    const [infoFailure, setInfoFailure] = useState<string | null>(null);
    const [recheck, setRecheck] = useState(0);
    const [initialName] = useState(request.suggest?.name ?? chatName);
    // What the conflicts are checked against: moved on blur and on a pick, not on every key. Null follows the first name.
    const [queryPath, setQueryPath] = useState<string | null>(request.suggest?.folder ?? null);

    // A suggested folder the chat worked in is picked from the cards, which know the project that is there, until the person picks one.
    const [folderPicked, setFolderPicked] = useState(false);
    const suggestedCard =
        info === null || request.suggest?.folder === undefined
            ? -1
            : info.folders.slice(0, MAX_WORKED_CARDS).findIndex((folder) => folder.path === request.suggest?.folder);
    const form: MoveForm = !folderPicked && suggestedCard >= 0 && typed.folder === 'new' ? { ...typed, folder: `worked:${suggestedCard}` } : typed;

    const newFolderFor = (name: string): string => (info === null ? '' : newFolderOf(info.newFolderParent, name));
    const folderText = pathEdited ? form.newPath : newFolderFor(form.name);
    const queryTarget = moveTargetOf(form, info, queryPath ?? newFolderFor(initialName));
    const queryKey = JSON.stringify(queryTarget);

    useEffect(() => {
        let current = true;
        const to = JSON.parse(queryKey) as ReturnType<typeof moveTargetOf>;
        transport
            .request('chat.moveInfo', { chatId: request.chatId, ...(to === null ? {} : { to }) })
            .then((answer) => {
                if (current) {
                    setInfo(answer);
                    setInfoFailure(null);
                }
            })
            .catch((e: unknown) => {
                if (current) {
                    setInfoFailure(messageOf(e, t('moveChat.infoFailed')));
                }
            });
        return () => {
            current = false;
        };
    }, [transport, request.chatId, queryKey, recheck, t]);

    // The reason to refuse is the chat's state of now: ask again when it changes, so a chat that finishes its turn can move without reopening the dialog.
    useEffect(
        () =>
            transport.on('chat.status', ({ chatId }) => {
                if (chatId === request.chatId) {
                    setRecheck((n) => n + 1);
                }
            }),
        [transport, request.chatId]
    );

    const update = (patch: Partial<MoveForm>): void => {
        if (patch.folder !== undefined) {
            setFolderPicked(true);
        }
        setTyped((current) => ({ ...current, ...patch }));
    };
    const refusal = info?.refusal ?? null;
    const loading = info === null && infoFailure === null;
    const worked = info?.folders.slice(0, MAX_WORKED_CARDS) ?? [];
    const card = workedCard(info, form.folder);
    const projectName =
        form.destination === null
            ? null
            : form.destination === NEW_PROJECT
              ? (card?.project?.name ?? null)
              : (projects.find((project) => project.projectId === form.destination)?.name ?? null);
    const making = form.destination === NEW_PROJECT && card?.project == null;
    const target = moveTargetOf(form, info, folderText);
    const conflicts = info?.conflicts ?? [];
    const ownCount = info?.ownFiles.count ?? 0;
    const effectiveFiles: OwnFiles = conflicts.length > 0 || info === null ? 'leave' : (ownFiles ?? defaultOwnFiles(form));
    const nameMissing = making && form.name.trim() === '';
    const locked = refusal !== null || busy;
    const ready = !locked && !loading && target !== null && !nameMissing;
    const pickFolder = endpointId === LOCAL_ENDPOINT_ID ? desktop()?.pickFolder : undefined;

    const submit = async (): Promise<void> => {
        if (!ready || target === null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            await perform('chat.move', { endpointId, chatId: request.chatId, to: target, ownFiles: ownCount === 0 ? 'leave' : effectiveFiles });
            onDone();
        } catch (e) {
            const code = e instanceof ActionRefusal ? e.code : '';
            if (STALE_CODES.includes(code)) {
                setRecheck((n) => n + 1);
            }
            setFailure(messageOf(e, t('moveChat.failed')));
        } finally {
            setBusy(false);
        }
    };

    const submitOnEnter = (e: KeyboardEvent): void => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            void submit();
        }
    };

    const chooseFolder = async (): Promise<void> => {
        const chosen = await pickFolder?.(form.chosenPath === '' ? undefined : form.chosenPath);
        if (chosen) {
            update({ folder: 'choose', chosenPath: chosen });
            setQueryPath(chosen);
        }
    };

    const onFolder = (next: FolderChoice): void => {
        if (next === 'choose' && pickFolder !== undefined) {
            void chooseFolder();
            return;
        }
        update({ folder: next });
        if (next === 'new') {
            setQueryPath(folderText);
        } else if (next === 'choose') {
            setQueryPath(form.chosenPath);
        }
    };

    const choices: Choice<FolderChoice>[] = [
        ...worked.map((folder, i): Choice<FolderChoice> => ({
            value: `worked:${i}`,
            title: folder.path,
            description:
                folder.project === null ? t('moveChat.workedFiles', { count: folder.files }) : t('moveChat.workedProject', { name: folder.project.name }),
            icon: Folder
        })),
        { value: 'new', title: t('moveChat.newFolder'), description: folderText === '' ? (info?.newFolderParent ?? '') : folderText, icon: FolderPlus },
        {
            value: 'choose',
            title: t('moveChat.chooseFolder'),
            description: form.chosenPath === '' ? t('moveChat.chooseFolderHint') : form.chosenPath,
            icon: FolderOpen
        }
    ];
    const Heading: LucideIcon = making || form.destination === null ? FolderPlus : FolderInput;
    const title = making || form.destination === null || projectName === null ? t('moveChat.titleMake') : t('moveChat.titleMove', { project: projectName });

    return (
        <>
            <Dialog.Title className="flex items-center gap-2">
                <Icon icon={Heading} size={16} /> {title}
            </Dialog.Title>
            {refusal !== null && <FormError className="mt-2">{refusalText(t, refusal)}</FormError>}
            {infoFailure !== null && info === null && <FormError className="mt-2">{infoFailure}</FormError>}

            {asksProject && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('moveChat.project')}</span>
                    <Select
                        label={t('moveChat.project')}
                        variant="outlined"
                        value={form.destination}
                        placeholder={t('moveChat.chooseProject')}
                        disabled={locked}
                        onValueChange={(value) => update({ destination: value })}
                        searchable={8}
                        items={[
                            { value: NEW_PROJECT, label: t('moveChat.newProject'), icon: <Icon icon={FolderPlus} size={16} /> },
                            ...projects.map((project) => ({
                                value: project.projectId,
                                label: project.name,
                                icon: <Glyph project={project} endpointId={endpointId} />
                            }))
                        ]}
                    />
                </div>
            )}

            {making && (
                <>
                    <label className="mt-3 block text-xs text-text-muted" htmlFor="move-chat-name">
                        {t('moveChat.name')}
                    </label>
                    <Input
                        id="move-chat-name"
                        autoFocus
                        className="mt-1"
                        value={form.name}
                        spellCheck={false}
                        disabled={locked}
                        onChange={(e) => update({ name: e.target.value })}
                        onBlur={() => form.folder === 'new' && setQueryPath(folderText)}
                        onKeyDown={submitOnEnter}
                    />
                </>
            )}

            {form.destination === NEW_PROJECT && (
                <div className="mt-3">
                    <span className="block text-xs text-text-muted">{t('moveChat.folder')}</span>
                    {loading && (
                        <div className="mt-1">
                            <p className="text-xs text-text-muted">{t('moveChat.looking')}</p>
                            <div className="mt-2 grid gap-2">
                                <Skeleton className="h-14 w-full rounded-xl" />
                                <Skeleton className="h-14 w-full rounded-xl" />
                            </div>
                        </div>
                    )}
                    <ChoiceCards
                        className="mt-2"
                        label={t('moveChat.folder')}
                        orientation="vertical"
                        radio="end"
                        value={form.folder}
                        onValueChange={onFolder}
                        choices={choices}
                        disabled={locked}
                        detail={
                            form.folder === 'new' ? (
                                <div className="grid gap-2 px-1">
                                    <Input
                                        mono
                                        aria-label={t('moveChat.folderPath')}
                                        value={folderText}
                                        spellCheck={false}
                                        disabled={locked}
                                        onChange={(e) => {
                                            setPathEdited(true);
                                            update({ newPath: e.target.value });
                                        }}
                                        onBlur={() => setQueryPath(folderText)}
                                        onKeyDown={submitOnEnter}
                                    />
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-text">{t('moveChat.initGit')}</span>
                                        <Switch
                                            label={t('moveChat.initGit')}
                                            checked={form.initGit}
                                            disabled={locked}
                                            onCheckedChange={(initGit) => update({ initGit })}
                                        />
                                    </div>
                                </div>
                            ) : form.folder === 'choose' ? (
                                pickFolder === undefined ? (
                                    <div className="px-1">
                                        <Input
                                            mono
                                            aria-label={t('moveChat.folderPath')}
                                            value={form.chosenPath}
                                            spellCheck={false}
                                            disabled={locked}
                                            onChange={(e) => update({ chosenPath: e.target.value })}
                                            onBlur={() => setQueryPath(form.chosenPath)}
                                            onKeyDown={submitOnEnter}
                                        />
                                    </div>
                                ) : (
                                    <div className="px-1">
                                        <Button disabled={locked} onClick={() => void chooseFolder()}>
                                            {t('moveChat.chooseFolder')}
                                        </Button>
                                    </div>
                                )
                            ) : undefined
                        }
                    />
                </div>
            )}

            {ownCount > 0 && info !== null && (
                <div className="mt-3">
                    <span className="block text-xs text-text-muted">{t('moveChat.ownFiles')}</span>
                    <Segmented
                        className="mt-1"
                        label={t('moveChat.ownFiles')}
                        value={effectiveFiles}
                        onValueChange={setOwnFiles}
                        disabled={locked || conflicts.length > 0}
                        options={[
                            { id: 'move', label: t('moveChat.ownFilesMove') },
                            { id: 'leave', label: t('moveChat.ownFilesLeave') }
                        ]}
                    />
                    <FieldHint>{t('moveChat.ownFilesList', { count: ownCount, names: info.ownFiles.names.join(', ') })}</FieldHint>
                </div>
            )}
            {conflicts.length > 0 && (
                <Note icon={TriangleAlert}>
                    {t('moveChat.conflict', {
                        name: conflicts[0],
                        project: projectName ?? baseName(target !== null && 'folder' in target ? target.folder : '')
                    })}
                </Note>
            )}
            {info !== null && info.references > 0 && <Note icon={AtSign}>{t('moveChat.references', { count: info.references })}</Note>}

            {/* The reason from the question says it in our words; the machine's sentence is for when the question finds nothing. */}
            {failure !== null && refusal === null && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                {refusal === null ? (
                    <>
                        <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
                            {making ? (busy ? t('moveChat.making') : t('moveChat.make')) : busy ? t('moveChat.moving') : t('moveChat.move')}
                        </Button>
                    </>
                ) : (
                    <Button onClick={onDone}>{t('moveChat.close')}</Button>
                )}
            </Dialog.Footer>
        </>
    );
}

function Glyph({ project, endpointId }: { project: ProjectSummary; endpointId: string }) {
    return <ProjectGlyph projectId={project.projectId} endpointId={endpointId} icon={project.icon} color={project.color} />;
}

function Note({ icon, children }: { icon: LucideIcon; children: string }) {
    return (
        <p className="mt-2 flex items-start gap-2 text-xs text-text-muted">
            <Icon icon={icon} size={16} className="shrink-0" />
            <span>{children}</span>
        </p>
    );
}

function refusalText(t: (key: string, options?: Record<string, unknown>) => string, refusal: ChatMoveRefusal): string {
    if (refusal.reason === 'owed') {
        return refusal.at === undefined ? t('moveChat.refusal.owed') : t('moveChat.refusal.owedAt', { time: formatMoment(new Date(refusal.at)) });
    }
    return t(`moveChat.refusal.${refusal.reason}`);
}
