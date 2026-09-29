import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Plus, Rocket, Search, X } from 'lucide-react';
import type { LaunchConfigEntry, LaunchConfigKind, LaunchesDocument, LaunchSuggestion } from '@ruimte/contracts';
import {
    Button,
    CloseButton,
    Dialog,
    ErrorBoundary,
    Field,
    FieldHint,
    FormError,
    Icon,
    IconButton,
    Input,
    PanelEmpty,
    Segmented,
    Select,
    Switch
} from '@basmilius/react-ui';
import {
    draftOf,
    draftProblem,
    emptyRow,
    folderRoots,
    importedLaunches,
    joinFolder,
    newDraft,
    newSuggestions,
    savedLaunches,
    splitFolder,
    suggestionSource,
    withoutDraft,
    type EnvRow,
    type LaunchDraft
} from '@/launches/editing';
import { useLaunches, useLaunchSuggestions, useProjectLaunches } from '@/launches/state';
import { useProjectRepos } from '@/state/git-repos';
import { useTransport } from '@/transport/context';
import { TransportError } from '@/transport/transport';

const PROJECT_FOLDER = '.';

const close = (): void => useLaunches.getState().setDialog(null);

let draftCount = 0;
const freshId = (): string => `new:${++draftCount}`;

/* The editor and the import, whichever the chip or the menu asked for. */
export function LaunchDialogs() {
    const { t } = useTranslation('launches');
    const dialog = useLaunches((s) => s.dialog);
    const { key, projectId, document } = useProjectLaunches();

    return (
        <Dialog.Root
            open={dialog !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup className={clsx('flex flex-col', dialog?.kind === 'import' ? 'h-[560px] w-[640px]' : 'h-[640px] w-[800px]')}>
                <div className="flex items-center gap-4 border-b border-border px-5 py-4">
                    <Dialog.Title className="flex grow items-center gap-2">
                        <Icon icon={Rocket} size={16} /> {dialog?.kind === 'import' ? t('import.title') : t('edit.title')}
                    </Dialog.Title>
                    <CloseButton label={t('edit.cancel')} dialog />
                </div>
                <Dialog.Description className="sr-only">{dialog?.kind === 'import' ? t('import.description') : t('edit.description')}</Dialog.Description>
                <ErrorBoundary label={t('edit.failed')} resetKeys={[key, dialog?.kind]}>
                    {document === null || projectId === null ? (
                        <PanelEmpty busy>{t('panel.reading')}</PanelEmpty>
                    ) : dialog?.kind === 'import' ? (
                        <ImportForm key={key} projectId={projectId} document={document} />
                    ) : dialog?.kind === 'edit' ? (
                        <EditForm key={key} projectId={projectId} document={document} launchId={dialog.launchId} />
                    ) : null}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

type Failure = { conflict: true } | { conflict: false; message: string };

const failureOf = (e: unknown, fallback: string): Failure =>
    e instanceof TransportError && e.code === 'rev-conflict' ? { conflict: true } : { conflict: false, message: e instanceof Error ? e.message : fallback };

/*
 * Every launch of the project at once, a list on the left and the chosen one on the right, saved as a
 * whole against the rev it was read at. A save by a person approves what it adds or changes.
 */
function EditForm({ projectId, document, launchId }: { projectId: string; document: LaunchesDocument; launchId: string | null }) {
    const { t } = useTranslation('launches');
    const transport = useTransport();
    const [start] = useState(() => {
        const drafts = document.launches.map(draftOf);
        if (launchId !== null && drafts.some((draft) => draft.entry.id === launchId)) {
            return { drafts, selected: launchId };
        }
        const draft = newDraft(freshId(), 'service');
        return { drafts: [...drafts, draft], selected: draft.entry.id };
    });
    const [drafts, setDrafts] = useState<LaunchDraft[]>(start.drafts);
    const [selectedId, setSelectedId] = useState<string | null>(start.selected);
    const [baseRev, setBaseRev] = useState(document.rev);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<Failure | null>(null);

    const selected = drafts.find((draft) => draft.entry.id === selectedId) ?? null;
    const problem = draftProblem(drafts);

    function update(id: string, change: (draft: LaunchDraft) => LaunchDraft) {
        setDrafts((current) => current.map((draft) => (draft.entry.id === id ? change(draft) : draft)));
    }

    function add() {
        const draft = newDraft(freshId(), 'service');
        setDrafts((current) => [...current, draft]);
        setSelectedId(draft.entry.id);
        setTried(false);
    }

    function remove(id: string) {
        const at = drafts.findIndex((draft) => draft.entry.id === id);
        const rest = withoutDraft(drafts, id);
        setDrafts(rest);
        setSelectedId(rest[Math.min(at, rest.length - 1)]?.entry.id ?? null);
    }

    /* `document` is the latest the machine sent, since a change re-renders this form rather than remounting it. */
    function startOver() {
        setDrafts(document.launches.map(draftOf));
        setBaseRev(document.rev);
        setSelectedId(document.launches.some((launch) => launch.id === selectedId) ? selectedId : (document.launches[0]?.id ?? null));
        setFailure(null);
        setTried(false);
    }

    async function save() {
        setTried(true);
        if (problem !== null) {
            setSelectedId(problem.id);
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            await transport.request('launches.save', { projectId, baseRev, launches: savedLaunches(drafts) });
            close();
        } catch (e) {
            setFailure(failureOf(e, t('edit.failed')));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <div className="flex min-h-0 grow">
                <div className="flex w-56 shrink-0 flex-col border-r border-border">
                    <div className="min-h-0 grow overflow-y-auto p-2">
                        {drafts.length === 0 && <p className="px-2 py-1.5 text-xs text-text-faint">{t('edit.empty')}</p>}
                        {drafts.map((draft) => (
                            <button
                                key={draft.entry.id}
                                type="button"
                                aria-current={draft.entry.id === selectedId}
                                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover aria-[current=true]:bg-surface-active"
                                onClick={() => setSelectedId(draft.entry.id)}
                            >
                                <span className={clsx('min-w-0 grow truncate', draft.entry.name.trim() === '' ? 'text-text-faint italic' : 'text-text')}>
                                    {draft.entry.name.trim() === '' ? t('edit.untitled') : draft.entry.name}
                                </span>
                                <span className="shrink-0 text-xs text-text-faint">{t(`edit.kinds.${draft.entry.kind}`)}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-col gap-1 border-t border-border p-2">
                        <Button variant="ghost" size="sm" className="justify-start" onClick={add}>
                            <Icon icon={Plus} size={14} /> {t('edit.new')}
                        </Button>
                        <Button variant="ghost" size="sm" className="justify-start" onClick={() => useLaunches.getState().setDialog({ kind: 'import' })}>
                            <Icon icon={Search} size={14} /> {t('edit.find')}
                        </Button>
                    </div>
                </div>
                <div className="min-h-0 grow overflow-y-auto px-5 py-4">
                    {selected === null ? (
                        <PanelEmpty icon={Rocket}>{t('edit.empty')}</PanelEmpty>
                    ) : (
                        <LaunchForm
                            key={selected.entry.id}
                            draft={selected}
                            drafts={drafts}
                            problem={tried && problem?.id === selected.entry.id ? problem.problem : null}
                            onChange={(change) => update(selected.entry.id, change)}
                        />
                    )}
                </div>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                {selected !== null && (
                    <Button variant="danger-outline" onClick={() => remove(selected.entry.id)}>
                        {t('edit.delete')}
                    </Button>
                )}
                <span className="min-w-0 grow">
                    {failure !== null && (
                        <FormError className="flex items-center gap-2">
                            <span className="min-w-0 truncate">{failure.conflict ? t('edit.conflict') : failure.message}</span>
                            {failure.conflict && (
                                <Button variant="ghost" size="xs" onClick={startOver}>
                                    {t('edit.startOver')}
                                </Button>
                            )}
                        </FormError>
                    )}
                </span>
                <Dialog.Close render={<Button variant="secondary" />}>{t('edit.cancel')}</Dialog.Close>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>
                    {t('edit.save')}
                </Button>
            </div>
        </>
    );
}

function LaunchForm({
    draft,
    drafts,
    problem,
    onChange
}: {
    draft: LaunchDraft;
    drafts: readonly LaunchDraft[];
    problem: 'name' | 'command' | 'members' | null;
    onChange(change: (draft: LaunchDraft) => LaunchDraft): void;
}) {
    const { t } = useTranslation('launches');
    const { folder } = useProjectLaunches();
    const { repos } = useProjectRepos(folder);
    const roots = useMemo(() => folderRoots(repos), [repos]);
    const [place, setPlace] = useState(() => splitFolder(draft.entry.cwd, roots));
    const { entry } = draft;
    const set = (fields: Partial<LaunchConfigEntry>): void => onChange((current) => ({ ...current, entry: { ...current.entry, ...fields } }));
    const setEnv = (env: EnvRow[]): void => onChange((current) => ({ ...current, env }));
    const moveTo = (root: string, sub: string): void => {
        setPlace({ root, sub });
        set({ cwd: joinFolder(root, sub) });
    };
    const members = drafts.filter((candidate) => candidate.entry.kind !== 'group' && candidate.entry.id !== entry.id);
    const hasOverlay = entry.overlay !== undefined && (entry.overlay.cwd !== undefined || Object.keys(entry.overlay.env ?? {}).length > 0);
    // A root the checkouts no longer list still reads as itself until the person picks another.
    const rootItems = [...new Set([...roots, place.root])].map((root) => ({
        value: root === '' ? PROJECT_FOLDER : root,
        label: root === '' ? t('edit.projectFolder') : root
    }));

    return (
        <div className="flex flex-col gap-4">
            <Field label={t('edit.name')} error={problem === 'name' ? t('edit.problem.name') : undefined}>
                <Input value={entry.name} autoFocus={entry.name === ''} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('edit.kind')} hint={t(`edit.kindHint.${entry.kind}`)}>
                <Segmented<LaunchConfigKind>
                    label={t('edit.kind')}
                    value={entry.kind}
                    onValueChange={(kind) => set({ kind })}
                    options={(['service', 'task', 'group'] as const).map((kind) => ({ id: kind, label: t(`edit.kinds.${kind}`) }))}
                />
            </Field>
            {entry.kind === 'group' ? (
                <Field label={t('edit.members')} error={problem === 'members' ? t('edit.problem.members') : undefined} group>
                    {members.length === 0 && <FieldHint>{t('edit.noMembers')}</FieldHint>}
                    {members.map((member) => {
                        const name = member.entry.name.trim() === '' ? t('edit.untitled') : member.entry.name;
                        const checked = (entry.launches ?? []).includes(member.entry.id);
                        return (
                            <label key={member.entry.id} className="flex h-8 items-center gap-3">
                                <Switch
                                    label={name}
                                    checked={checked}
                                    onCheckedChange={(on) =>
                                        set({
                                            launches: on
                                                ? [...(entry.launches ?? []), member.entry.id]
                                                : (entry.launches ?? []).filter((id) => id !== member.entry.id)
                                        })
                                    }
                                />
                                <span className="text-text">{name}</span>
                            </label>
                        );
                    })}
                </Field>
            ) : (
                <>
                    <Field label={t('edit.directory')} group>
                        <div className="flex gap-2">
                            <Select<string>
                                label={t('edit.directory')}
                                className="w-48 shrink-0"
                                value={place.root === '' ? PROJECT_FOLDER : place.root}
                                items={rootItems}
                                onValueChange={(root) => moveTo(root === PROJECT_FOLDER ? '' : root, place.sub)}
                            />
                            <Input
                                mono
                                className="grow"
                                aria-label={t('edit.subfolder')}
                                placeholder={t('edit.subfolder')}
                                value={place.sub}
                                onChange={(e) => moveTo(place.root, e.target.value)}
                            />
                        </div>
                    </Field>
                    <Field label={t('edit.command')} error={problem === 'command' ? t('edit.problem.command') : undefined}>
                        <Input mono value={entry.command ?? ''} onChange={(e) => set({ command: e.target.value })} />
                    </Field>
                    {entry.kind === 'service' && (
                        <Field label={t('edit.address')}>
                            <Input mono placeholder="http://localhost:8000" value={entry.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
                        </Field>
                    )}
                    <Field label={t('edit.environment')} group>
                        {draft.env.map((row) => (
                            <div key={row.id} className="flex items-center gap-2">
                                <Input
                                    mono
                                    size="sm"
                                    className="w-48 shrink-0"
                                    aria-label={t('edit.envKey')}
                                    placeholder={t('edit.envKey')}
                                    value={row.key}
                                    onChange={(e) => setEnv(draft.env.map((other) => (other.id === row.id ? { ...other, key: e.target.value } : other)))}
                                />
                                <Input
                                    mono
                                    size="sm"
                                    className="grow"
                                    aria-label={t('edit.envValue')}
                                    placeholder={t('edit.envValue')}
                                    value={row.value}
                                    onChange={(e) => setEnv(draft.env.map((other) => (other.id === row.id ? { ...other, value: e.target.value } : other)))}
                                />
                                <IconButton
                                    icon={X}
                                    size="sm"
                                    label={t('edit.removeVariable', { key: row.key })}
                                    onClick={() => setEnv(draft.env.filter((other) => other.id !== row.id))}
                                />
                            </div>
                        ))}
                        <div>
                            <Button variant="ghost" size="sm" onClick={() => setEnv([...draft.env, emptyRow(draft.env)])}>
                                <Icon icon={Plus} size={14} /> {t('edit.addVariable')}
                            </Button>
                        </div>
                    </Field>
                </>
            )}
            <label className="flex items-start gap-3">
                <Switch label={t('edit.autostart')} checked={entry.autostart === true} onCheckedChange={(autostart) => set({ autostart })} />
                <span className="flex flex-col">
                    <span className="text-text">{t('edit.autostart')}</span>
                    <FieldHint>{t('edit.autostartHint')}</FieldHint>
                </span>
            </label>
            <label className="flex items-start gap-3">
                <Switch label={t('edit.share')} checked={entry.shared} onCheckedChange={(shared) => set({ shared })} />
                <span className="flex flex-col">
                    <span className="text-text">{t('edit.share')}</span>
                    <FieldHint>{t('edit.shareHint')}</FieldHint>
                </span>
            </label>
            {entry.shared && hasOverlay && <FieldHint>{t('edit.overlay')}</FieldHint>}
        </div>
    );
}

/* What the machine found in the project, each with the command it becomes; nothing is saved until the import. */
function ImportForm({ projectId, document }: { projectId: string; document: LaunchesDocument }) {
    const { t } = useTranslation('launches');
    const transport = useTransport();
    const { suggestions, failed } = useLaunchSuggestions(projectId);
    const offered = useMemo(() => (suggestions === null ? null : newSuggestions(suggestions, document)), [suggestions, document]);
    const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
    const [share, setShare] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<Failure | null>(null);
    const picked = (offered ?? []).filter((suggestion) => suggestion.unsupported === undefined && !skipped.has(suggestion.launch.id));

    async function importPicked() {
        setBusy(true);
        setFailure(null);
        try {
            const launches = [...document.launches, ...importedLaunches(picked, share, document)];
            await transport.request('launches.save', { projectId, baseRev: document.rev, launches });
            close();
        } catch (e) {
            setFailure(failureOf(e, t('edit.failed')));
        } finally {
            setBusy(false);
        }
    }

    const body =
        offered === null ? (
            <PanelEmpty busy>{t('import.searching')}</PanelEmpty>
        ) : failed ? (
            <PanelEmpty icon={Search}>{t('import.failed')}</PanelEmpty>
        ) : offered.length === 0 ? (
            <PanelEmpty icon={Search}>{t('import.nothing')}</PanelEmpty>
        ) : (
            <div className="min-h-0 grow overflow-y-auto py-2">
                {offered.map((suggestion) => (
                    <SuggestionRow
                        key={suggestion.launch.id}
                        suggestion={suggestion}
                        checked={!skipped.has(suggestion.launch.id)}
                        onCheckedChange={(on) => {
                            const next = new Set(skipped);
                            if (on) {
                                next.delete(suggestion.launch.id);
                            } else {
                                next.add(suggestion.launch.id);
                            }
                            setSkipped(next);
                        }}
                    />
                ))}
            </div>
        );

    return (
        <>
            <p className="border-b border-border px-5 py-3 text-xs text-text-muted">{t('import.description')}</p>
            {body}
            <div className="flex items-center gap-3 border-t border-border px-5 py-3">
                <label className="flex min-w-0 items-center gap-3">
                    <Switch label={t('import.share')} checked={share} onCheckedChange={setShare} />
                    <span className="min-w-0 truncate text-text">{t('import.share')}</span>
                </label>
                <span className="min-w-0 grow">
                    {failure !== null && <FormError className="truncate">{failure.conflict ? t('edit.conflict') : failure.message}</FormError>}
                </span>
                <Dialog.Close render={<Button variant="secondary" />}>{t('import.cancel')}</Dialog.Close>
                <Button variant="primary" disabled={busy || picked.length === 0} onClick={() => void importPicked()}>
                    {t('import.confirm', { count: picked.length })}
                </Button>
            </div>
        </>
    );
}

function SuggestionRow({ suggestion, checked, onCheckedChange }: { suggestion: LaunchSuggestion; checked: boolean; onCheckedChange(checked: boolean): void }) {
    const { t } = useTranslation('launches');
    const { launch } = suggestion;
    const unsupported = suggestion.unsupported !== undefined;

    return (
        <label className={clsx('flex items-start gap-3 px-5 py-2', unsupported && 'opacity-60')}>
            <Switch
                label={t('import.pick', { name: launch.name })}
                checked={checked && !unsupported}
                disabled={unsupported}
                onCheckedChange={onCheckedChange}
            />
            <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-text">{launch.name}</span>
                    <span className="min-w-0 truncate text-xs text-text-faint">{suggestionSource(suggestion)}</span>
                </span>
                {launch.command !== undefined && (
                    <code className="truncate font-mono text-xs text-text-muted">
                        {launch.cwd !== undefined && <span className="text-text-faint">{launch.cwd} $ </span>}
                        {launch.command}
                    </code>
                )}
                {unsupported && <span className="text-xs text-text-faint">{t('import.unsupported', { reason: suggestion.unsupported })}</span>}
                {!unsupported && suggestion.private && <span className="text-xs text-text-faint">{t('import.private')}</span>}
            </span>
        </label>
    );
}
