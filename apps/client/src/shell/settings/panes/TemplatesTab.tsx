import { BUILT_IN_LIVE_TEMPLATES, BUILT_IN_POSTFIX_TEMPLATES } from '@adecore/editor-react';
import { Button, Icon, IconButton, Input, Pill, PromptDialog, Spinner, Switch, messageOf } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { LiveTemplate as StoredLiveTemplate, PostfixTemplate as StoredPostfixTemplate, TemplateKind, TemplateScope } from '@ruimte/contracts';
import { Plus, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { copyOf, draftOfLive, draftOfPostfix, emptyDraft, type TemplateDraft } from '@/language/template-draft';
import { TemplateDialog } from '@/language/TemplateDialog';
import { useTemplates, type TemplatesTracker } from '@/language/templates';
import { useWindowProjectLanguage } from '@/shell/settings/panes/window-project-language';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useToasts } from '@/state/toasts';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { useWindow, workspaceOf } from '@/workspace/window';

type Origin = 'builtIn' | 'personal' | 'project' | 'agent';

type GroupId = 'script' | 'php' | 'css' | 'html' | 'xml' | 'other';

const GROUPS: readonly GroupId[] = ['script', 'php', 'css', 'html', 'xml', 'other'];

/* One template of the list, whoever it belongs to. */
interface Entry {
    id: string;
    kind: TemplateKind;
    key: string;
    description: string;
    example: string;
    origin: Origin;
    languages: readonly string[];
    /* Where an own template is stored; absent for a built-in. */
    scope?: TemplateScope;
    stored?: StoredLiveTemplate | StoredPostfixTemplate;
}

function groupOf(languages: readonly string[]): GroupId {
    switch (languages[0]) {
        case 'javascript':
        case 'typescript':
            return 'script';
        case 'php':
        case 'css':
        case 'html':
        case 'xml':
            return languages[0];
        default:
            return 'other';
    }
}

function ownEntry(kind: TemplateKind, template: StoredLiveTemplate | StoredPostfixTemplate, scope: TemplateScope): Entry {
    return {
        id: template.id,
        kind,
        key: template.key,
        description: template.description ?? '',
        example: 'example' in template ? (template.example ?? '') : '',
        origin: template.addedBy === undefined ? (scope === 'project' ? 'project' : 'personal') : 'agent',
        languages: template.languages,
        scope,
        stored: template
    };
}

/* Built-ins first, then the person's own, then the project's. */
function entriesOf(kind: TemplateKind, snapshot: NonNullable<ReturnType<typeof useTemplates>>): Entry[] {
    const builtIns = (kind === 'live' ? BUILT_IN_LIVE_TEMPLATES : BUILT_IN_POSTFIX_TEMPLATES).map((template): Entry => ({
        id: template.id,
        kind,
        key: template.key,
        description: template.description ?? '',
        example: 'example' in template ? (template.example ?? '') : '',
        origin: 'builtIn',
        languages: template.languages
    }));
    const personal = (kind === 'live' ? snapshot.personal.live : snapshot.personal.postfix).map((template) => ownEntry(kind, template, 'personal'));
    const project = (kind === 'live' ? (snapshot.project?.live ?? []) : (snapshot.project?.postfix ?? [])).map((template) =>
        ownEntry(kind, template, 'project')
    );

    return [...builtIns, ...personal, ...project];
}

function matches(entry: Entry, query: string): boolean {
    const needle = query.trim().toLowerCase();

    return needle === '' || entry.key.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle);
}

/* The templates of this window's machine, and the project's, for the project the window shows. */
export function TemplatesTab() {
    const { t } = useTranslation('settings');
    const language = useWindowProjectLanguage();

    if (language === null) {
        return (
            <SettingsSection title={t('editor.templates.title')}>
                <SettingsRow muted searchId="editor.templates.live" label={t('editor.templates.needsProject')} />
            </SettingsSection>
        );
    }

    return <Templates tracker={language.templateSync} />;
}

function Templates({ tracker }: { tracker: TemplatesTracker }) {
    const { t } = useTranslation('settings');
    const endpointId = useWindow((s) => workspaceOf(s.content)?.connection.endpointId ?? '');
    const connection = useEndpointConnection(endpointId);
    const snapshot = useTemplates(tracker);
    const answers = machineAnswers(connection, 'template.list');
    const [query, setQuery] = useState('');
    const [dialog, setDialog] = useState<TemplateDraft | null>(null);
    const [removing, setRemoving] = useState<Entry | null>(null);

    if (!answers && connection.status === 'open') {
        return (
            <SettingsSection title={t('editor.templates.title')}>
                <SettingsRow muted searchId="editor.templates.live" label={t('editor.templates.tooOld')} />
            </SettingsSection>
        );
    }

    if (snapshot === null) {
        return (
            <SettingsSection title={t('editor.templates.title')}>
                <SettingsRow muted searchId="editor.templates.live" leading={<Spinner size={12} />} label={t('editor.templates.loading')} />
            </SettingsSection>
        );
    }

    const fail = (error: unknown): void => {
        useToasts.getState().show({ kind: 'error', title: t('editor.templates.saveFailed'), description: messageOf(error) });
    };
    const switchOf = (entry: Entry) => (
        <Switch
            checked={!snapshot.personal.disabled.includes(entry.id)}
            label={t('editor.templates.enable', { key: entry.kind === 'postfix' ? `.${entry.key}` : entry.key })}
            onCheckedChange={(on) =>
                void tracker
                    .configure({ disabled: on ? snapshot.personal.disabled.filter((id) => id !== entry.id) : [...snapshot.personal.disabled, entry.id] })
                    .catch(fail)
            }
        />
    );
    const edit = (entry: Entry): void => {
        const stored = entry.stored;
        if (stored === undefined || entry.scope === undefined) {
            return;
        }
        setDialog(
            entry.kind === 'live' ? draftOfLive(stored as StoredLiveTemplate, entry.scope) : draftOfPostfix(stored as StoredPostfixTemplate, entry.scope)
        );
    };
    const duplicate = (entry: Entry): void => {
        const live = BUILT_IN_LIVE_TEMPLATES.find((template) => template.id === entry.id);
        const postfixed = BUILT_IN_POSTFIX_TEMPLATES.find((template) => template.id === entry.id);
        if (live !== undefined) {
            setDialog(copyOf(draftOfLive(live, 'personal')));
        } else if (postfixed !== undefined) {
            setDialog(copyOf(draftOfPostfix(postfixed, 'personal')));
        }
    };
    const rowOf = (entry: Entry) => (
        <TemplateRow
            key={`${entry.origin}:${entry.id}`}
            entry={entry}
            control={
                entry.origin === 'builtIn' ? (
                    <>
                        <Button size="sm" onClick={() => duplicate(entry)}>
                            {t('editor.templates.duplicate')}
                        </Button>
                        {switchOf(entry)}
                    </>
                ) : (
                    <>
                        <Button size="sm" onClick={() => edit(entry)}>
                            {t('editor.templates.edit')}
                        </Button>
                        <Button size="sm" variant="danger-outline" onClick={() => setRemoving(entry)}>
                            {t('editor.templates.remove')}
                        </Button>
                    </>
                )
            }
        />
    );

    const live = entriesOf('live', snapshot);
    const postfix = entriesOf('postfix', snapshot);
    const visibleLive = live.filter((entry) => matches(entry, query));
    const visiblePostfix = postfix.filter((entry) => matches(entry, query));
    const searching = query.trim() !== '';
    const noMatch = t('editor.templates.noMatch', { query: query.trim() });
    const ownLive = live.some((entry) => entry.origin !== 'builtIn');
    const settings = snapshot.personal.settings;
    const switchRow = (field: 'liveInCompletion' | 'postfix' | 'postfixInCompletion', id: string, words: string) => (
        <SettingsRow
            searchId={id}
            label={t(`editor.templates.${words}.label`)}
            description={t(`editor.templates.${words}.description`)}
            control={
                <Switch
                    checked={settings[field] !== false}
                    label={t(`editor.templates.${words}.label`)}
                    onCheckedChange={(on) => void tracker.configure({ settings: { [field]: on } }).catch(fail)}
                />
            }
        />
    );

    return (
        <>
            <div className="relative shrink-0">
                <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" aria-hidden />
                <Input
                    className="px-8 text-xs"
                    placeholder={t('editor.templates.search')}
                    aria-label={t('editor.templates.search')}
                    value={query}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        // Escape clears the search first; the dialog only closes on an empty field.
                        if (e.key === 'Escape' && query) {
                            e.stopPropagation();
                            setQuery('');
                        }
                    }}
                />
                {query && (
                    <IconButton
                        icon={X}
                        size="sm"
                        label={t('editor.templates.clearSearch')}
                        tooltip={false}
                        className="absolute top-1/2 right-1 -translate-y-1/2"
                        onClick={() => setQuery('')}
                    />
                )}
            </div>
            <SettingsSection
                title={t('editor.templates.sections.live.title')}
                description={t('editor.templates.sections.live.description')}
                action={
                    <Button size="sm" onClick={() => setDialog(emptyDraft('live'))}>
                        <Icon icon={Plus} size={14} /> {t('editor.templates.add')}
                    </Button>
                }
            >
                {switchRow('liveInCompletion', 'editor.templates.live', 'live')}
                {snapshot.projectTooNew && <SettingsRow muted label={t('editor.templates.projectTooNew')} />}
                {snapshot.projectInvalid && <SettingsRow muted label={t('editor.templates.projectInvalid')} />}
                {!ownLive && !searching && <SettingsRow muted label={t('editor.templates.empty')} />}
                {searching && visibleLive.length === 0 && <SettingsRow muted label={noMatch} />}
            </SettingsSection>
            {GROUPS.map((group) => {
                const entries = visibleLive.filter((entry) => groupOf(entry.languages) === group);

                return (
                    entries.length > 0 && (
                        <SettingsSection key={group} title={t(`editor.templates.sections.groups.${group}`)}>
                            {entries.map((entry) => rowOf(entry))}
                        </SettingsSection>
                    )
                );
            })}
            <SettingsSection title={t('editor.templates.sections.postfix.title')} description={t('editor.templates.sections.postfix.description')}>
                {switchRow('postfix', 'editor.templates.postfix', 'postfix')}
                {switchRow('postfixInCompletion', 'editor.templates.postfixInCompletion', 'postfixInCompletion')}
            </SettingsSection>
            <SettingsSection
                title={t('editor.templates.sections.postfixList.title')}
                action={
                    <Button size="sm" onClick={() => setDialog(emptyDraft('postfix'))}>
                        <Icon icon={Plus} size={14} /> {t('editor.templates.addPostfix')}
                    </Button>
                }
            >
                {visiblePostfix.length === 0 ? <SettingsRow muted label={noMatch} /> : visiblePostfix.map((entry) => rowOf(entry))}
            </SettingsSection>
            <TemplateDialog draft={dialog} tracker={tracker} onClose={() => setDialog(null)} />
            <PromptDialog
                open={removing !== null}
                title={t('editor.templates.removeTitle', { key: removing?.key ?? '' })}
                description={t('editor.templates.removeDescription')}
                confirmLabel={t('editor.templates.remove')}
                danger
                onConfirm={async () => {
                    if (removing?.scope !== undefined) {
                        await tracker.remove(removing.scope, removing.kind, removing.id);
                    }
                    setRemoving(null);
                }}
                onOpenChange={() => setRemoving(null)}
            />
        </>
    );
}

function TemplateRow({ entry, searchId, control }: { entry: Entry; searchId?: string; control: ReactNode }) {
    const { t } = useTranslation('settings');

    return (
        <SettingsRow
            searchId={searchId}
            label={
                <>
                    <span className="font-mono">{entry.kind === 'postfix' ? `.${entry.key}` : entry.key}</span>{' '}
                    <Pill size="sm" tone={entry.origin === 'agent' ? 'accent' : 'muted'}>
                        {t(`editor.templates.origin.${entry.origin}`)}
                    </Pill>
                </>
            }
            description={
                <>
                    {entry.description !== '' && <span className="block break-words">{entry.description}</span>}
                    {entry.example !== '' && <span className="block font-mono break-words">{entry.example}</span>}
                </>
            }
            control={control}
        />
    );
}
