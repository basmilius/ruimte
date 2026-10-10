import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageCustomCheckResult } from '@ruimte/contracts';
import { Button, Checkbox, Dialog, Field, FormError, Input, Segmented, TextArea } from '@adecore/ui';
import { useProjectList } from '@/state/project-list';
import { inputOf, problemOf, type CustomDraft, type DraftProblem } from './custom-draft';
import type { CustomServersTracker } from './custom-servers';

/* How long typing in the command field pauses before the machine is asked whether it is there. */
const CHECK_DELAY_MS = 350;

/*
 * Adds a language server of the person's own, or changes one. Saving is what approves starting exactly
 * this command on the machine, so the dialog says as much and nothing starts before it.
 */
export function CustomServerDialog({
    draft,
    endpointId,
    tracker,
    onClose
}: {
    /* The server to change, an empty draft for a new one, or null while the dialog is closed. */
    draft: CustomDraft | null;
    endpointId: string;
    tracker: CustomServersTracker;
    onClose(): void;
}) {
    const { t } = useTranslation('settings');

    return (
        <Dialog.Root open={draft !== null} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup className="flex max-h-[90vh] w-[640px] flex-col">
                <div className="min-h-0 overflow-y-auto px-5 pt-4">
                    <Dialog.Title>
                        {draft?.id === undefined ? t('editor.servers.own.dialog.titleAdd') : t('editor.servers.own.dialog.titleEdit', { name: draft.name })}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 mb-3 break-words">{t('editor.servers.own.dialog.description')}</Dialog.Description>
                </div>
                {draft !== null && <Form key={draft.id ?? 'new'} start={draft} endpointId={endpointId} tracker={tracker} onClose={onClose} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function Form({ start, endpointId, tracker, onClose }: { start: CustomDraft; endpointId: string; tracker: CustomServersTracker; onClose(): void }) {
    const { t } = useTranslation('settings');
    const [draft, setDraft] = useState(start);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const found = useCommandCheck(tracker, draft.command);
    const known = useProjectList((state) => state.projects);
    const choices = useMemo(
        () =>
            known
                .filter((row) => row.endpointId === endpointId && row.summary.scratch !== true)
                .map((row) => ({ folder: row.summary.folder, name: row.summary.name })),
        [known, endpointId]
    );
    // A folder the server was saved for that the list no longer has still reads as itself.
    const listed = useMemo(
        () => [
            ...choices,
            ...draft.projects.filter((folder) => !choices.some((choice) => choice.folder === folder)).map((folder) => ({ folder, name: folder }))
        ],
        [choices, draft.projects]
    );
    const problem = tried ? problemOf(draft) : null;
    const set = (fields: Partial<CustomDraft>): void => setDraft((current) => ({ ...current, ...fields }));
    const errorOf = (kind: DraftProblem): string | undefined => (problem === kind ? t(`editor.servers.own.dialog.problem.${kind}`) : undefined);

    async function save(): Promise<void> {
        setTried(true);
        if (problemOf(draft) !== null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            await tracker.save(inputOf(draft));
            onClose();
        } catch (error) {
            setFailure(error instanceof Error ? error.message : t('editor.servers.own.dialog.failed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-4">
                <Field orientation="horizontal" label={t('editor.servers.own.dialog.name')} error={errorOf('name')}>
                    <Input value={draft.name} autoFocus={draft.name === ''} onChange={(e) => set({ name: e.target.value })} />
                </Field>
                <Field
                    orientation="horizontal"
                    label={t('editor.servers.own.dialog.command')}
                    hint={commandHint(found, draft.command, t)}
                    error={errorOf('command')}
                >
                    <Input mono placeholder="zls" value={draft.command} onChange={(e) => set({ command: e.target.value })} />
                </Field>
                <Field orientation="horizontal" label={t('editor.servers.own.dialog.args')} hint={t('editor.servers.own.dialog.argsHint')}>
                    <GrowingArea rows={2} placeholder="--stdio" value={draft.args} onChange={(args) => set({ args })} />
                </Field>
                <Field
                    orientation="horizontal"
                    label={t('editor.servers.own.dialog.languages')}
                    error={errorOf('serves')}
                    hint={t('editor.servers.own.dialog.languagesHint')}
                >
                    <Input mono placeholder="zig" value={draft.languages} onChange={(e) => set({ languages: e.target.value })} />
                </Field>
                <Field
                    orientation="horizontal"
                    label={t('editor.servers.own.dialog.patterns')}
                    error={errorOf('pattern')}
                    hint={t('editor.servers.own.dialog.patternsHint')}
                >
                    <GrowingArea rows={2} placeholder="*.zig" value={draft.patterns} onChange={(patterns) => set({ patterns })} />
                </Field>
                <Field orientation="horizontal" label={t('editor.servers.own.dialog.env')} error={errorOf('env')} hint={t('editor.servers.own.dialog.envHint')}>
                    <GrowingArea rows={2} placeholder="NAME=value" value={draft.env} onChange={(env) => set({ env })} />
                </Field>
                <Field
                    orientation="horizontal"
                    label={t('editor.servers.own.dialog.options')}
                    error={errorOf('options')}
                    hint={t('editor.servers.own.dialog.optionsHint')}
                >
                    <GrowingArea rows={3} placeholder="{}" value={draft.options} onChange={(options) => set({ options })} />
                </Field>
                <Field orientation="horizontal" group label={t('editor.servers.own.dialog.scope')} error={errorOf('projects')}>
                    <div className="flex flex-col gap-2">
                        <Segmented<CustomDraft['scope']>
                            label={t('editor.servers.own.dialog.scope')}
                            value={draft.scope}
                            onValueChange={(scope) => set({ scope })}
                            options={[
                                { id: 'all', label: t('editor.servers.own.dialog.scopeAll') },
                                { id: 'some', label: t('editor.servers.own.dialog.scopeSome') }
                            ]}
                        />
                        {draft.scope === 'some' &&
                            listed.map((project) => (
                                <label key={project.folder} className="flex min-h-8 items-center gap-2.5">
                                    <Checkbox
                                        label={project.name}
                                        checked={draft.projects.includes(project.folder)}
                                        onCheckedChange={(on) => {
                                            const others = draft.projects.filter((folder) => folder !== project.folder);
                                            set({ projects: on ? [...others, project.folder] : others });
                                        }}
                                    />
                                    <span className="min-w-0 truncate text-text">{project.name}</span>
                                    {project.name !== project.folder && (
                                        <span className="min-w-0 truncate font-mono text-xs text-text-faint">{project.folder}</span>
                                    )}
                                </label>
                            ))}
                    </div>
                </Field>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                <span className="min-w-0 grow">{failure !== null && <FormError className="break-words">{failure}</FormError>}</span>
                <Dialog.Close render={<Button variant="secondary" />}>{t('editor.servers.own.dialog.cancel')}</Dialog.Close>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>
                    {t('editor.servers.own.dialog.save')}
                </Button>
            </div>
        </>
    );
}

/* A command field grows with what it holds, since flags rarely fit on one line. */
function GrowingArea({ rows, placeholder, value, onChange }: { rows: number; placeholder: string; value: string; onChange(value: string): void }) {
    return <TextArea mono rows={rows} className="field-sizing-content" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/* What the machine says about the command as it is typed: where it found it, or that it did not. Null before the first answer or with nothing typed. */
function useCommandCheck(tracker: CustomServersTracker, command: string): LanguageCustomCheckResult | null {
    const [answer, setAnswer] = useState<{ command: string; result: LanguageCustomCheckResult } | null>(null);

    useEffect(() => {
        const typed = command.trim();
        if (typed === '') {
            return;
        }
        let alive = true;
        const timer = window.setTimeout(() => {
            void tracker
                .check(typed)
                .then((result) => alive && setAnswer({ command: typed, result }))
                .catch(() => undefined);
        }, CHECK_DELAY_MS);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [tracker, command]);

    return answer !== null && answer.command === command.trim() ? answer.result : null;
}

function commandHint(found: LanguageCustomCheckResult | null, command: string, t: (key: string, options?: Record<string, unknown>) => string): string {
    if (command.trim() === '' || found === null) {
        return t('editor.servers.own.dialog.commandHint');
    }
    return found.found ? t('editor.servers.own.dialog.commandFound', { path: found.path }) : t('editor.servers.own.dialog.commandMissing');
}
