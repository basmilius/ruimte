import type { LiveTemplate, PostfixTemplate, TemplateLanguage, TemplatePlace, TemplateRegistry } from '@adecore/editor-react';
import {
    TEMPLATE_LANGUAGES,
    TEMPLATE_PLACES,
    POSTFIX_TEMPLATE_LANGUAGES,
    type LiveTemplate as StoredLiveTemplate,
    type LiveTemplateInput,
    type PersonalTemplates,
    type PostfixTemplate as StoredPostfixTemplate,
    type PostfixTemplateInput,
    type ProjectTemplates,
    type TemplateKind,
    type TemplateScope,
    type TemplateSettings
} from '@ruimte/contracts';
import i18next from 'i18next';
import { useSyncExternalStore } from 'react';
import { useToasts } from '@/state/toasts';
import { TransportError, type Transport, fireAndForget } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { SnapshotTracker, upsert } from './snapshot-tracker';

/* A template to save, with the kind that says which list it joins. */
export type TemplateInput =
    | { readonly kind: 'live'; readonly template: LiveTemplateInput }
    | { readonly kind: 'postfix'; readonly template: PostfixTemplateInput };

/*
 * What the machine holds of the editor's templates for one project: a person's own, and the project's
 * shared ones. `null` until the machine has answered, and for a machine that does not know templates.
 * `project` is null when the project has none to read, `projectTooNew` when its file is from a newer Ruimte
 * and `projectInvalid` when it is JSON that breaks the schema.
 */
export interface TemplatesSnapshot {
    readonly personal: PersonalTemplates;
    readonly project: ProjectTemplates | null;
    readonly projectTooNew: boolean;
    readonly projectInvalid: boolean;
}

export function isFamily(value: string): value is TemplateLanguage {
    return (TEMPLATE_LANGUAGES as readonly string[]).includes(value);
}

export function isPlace(value: string): value is TemplatePlace {
    return (TEMPLATE_PLACES as readonly string[]).includes(value);
}

function isPostfixFamily(value: string): value is PostfixTemplate['languages'][number] {
    return (POSTFIX_TEMPLATE_LANGUAGES as readonly string[]).includes(value);
}

/* A family or place a newer Ruimte added is left out, and a template that names no family at all is dropped by the registry. */
export function liveTemplateOf(stored: StoredLiveTemplate): LiveTemplate {
    return {
        id: stored.id,
        key: stored.key,
        body: stored.body,
        ...(stored.description === undefined ? {} : { description: stored.description }),
        languages: stored.languages.filter(isFamily),
        ...(stored.places === undefined ? {} : { places: stored.places.filter(isPlace) })
    };
}

export function postfixTemplateOf(stored: StoredPostfixTemplate): PostfixTemplate {
    return {
        id: stored.id,
        key: stored.key,
        body: stored.body,
        ...(stored.description === undefined ? {} : { description: stored.description }),
        ...(stored.example === undefined ? {} : { example: stored.example }),
        languages: stored.languages.filter(isPostfixFamily),
        ...(stored.expression === undefined ? {} : { expression: stored.expression })
    };
}

export class TemplatesTracker extends SnapshotTracker<TemplatesSnapshot | null> {
    private readonly projectId: string;
    private readonly registry: TemplateRegistry;

    constructor(transport: Transport, projectId: string, registry: TemplateRegistry) {
        super(transport, null);
        this.projectId = projectId;
        this.registry = registry;
        this.subscriptions.push(
            transport.on('template.changed', (event) => {
                if (this.snapshot === null) {
                    return;
                }

                if (event.scope === 'personal') {
                    this.replace({ ...this.snapshot, personal: event.snapshot });
                } else if (event.projectId === projectId) {
                    this.replace({ ...this.snapshot, project: event.snapshot, projectTooNew: false, projectInvalid: false });
                }
            })
        );
    }

    async refresh(): Promise<void> {
        if (!machineAnswers(this.transport.connection, 'template.list')) {
            return;
        }

        const { personal, project, projectTooNew, projectInvalid } = await this.transport.request('template.list', { projectId: this.projectId });
        this.replace({ personal, project, projectTooNew: projectTooNew === true, projectInvalid: projectInvalid === true });
    }

    /* Whether the project has a file to write: it is held and its file is not from a newer Ruimte. */
    get projectWritable(): boolean {
        return (this.snapshot?.project ?? null) !== null;
    }

    /* Each write returns false when the machine held newer templates: the list is read again and said so, and the caller keeps what a person typed. */
    save(scope: TemplateScope, input: TemplateInput): Promise<boolean> {
        return this.write(async () => {
            const payload = { scope, revision: this.revisionOf(scope), ...(scope === 'project' ? { projectId: this.projectId } : {}) };
            const reply =
                input.kind === 'live'
                    ? await this.transport.request('template.save', { ...payload, kind: 'live', template: input.template })
                    : await this.transport.request('template.save', { ...payload, kind: 'postfix', template: input.template });

            if (reply.kind === 'live') {
                this.amend(scope, (part) => ({ revision: reply.revision, live: upsert(part.live, reply.template, (other) => other.id === reply.template.id) }));
            } else {
                this.amend(scope, (part) => ({
                    revision: reply.revision,
                    postfix: upsert(part.postfix, reply.template, (other) => other.id === reply.template.id)
                }));
            }
        });
    }

    remove(scope: TemplateScope, kind: TemplateKind, id: string): Promise<boolean> {
        return this.write(async () => {
            const { revision } = await this.transport.request('template.remove', {
                scope,
                revision: this.revisionOf(scope),
                kind,
                id,
                ...(scope === 'project' ? { projectId: this.projectId } : {})
            });

            this.amend(scope, (part) => ({
                revision,
                ...(kind === 'live'
                    ? { live: part.live.filter((template) => template.id !== id) }
                    : { postfix: part.postfix.filter((template) => template.id !== id) })
            }));
        });
    }

    /* Which built-ins are off, and the switches; a key left out stays as it is. */
    configure(change: { readonly disabled?: readonly string[]; readonly settings?: TemplateSettings }): Promise<boolean> {
        return this.write(async () => {
            const reply = await this.transport.request('template.configure', {
                revision: this.revisionOf('personal'),
                ...(change.disabled === undefined ? {} : { disabled: [...change.disabled] }),
                ...(change.settings === undefined ? {} : { settings: change.settings })
            });

            this.update((current) => ({
                ...current,
                personal: { ...current.personal, revision: reply.revision, disabled: reply.disabled, settings: reply.settings }
            }));
        });
    }

    private async write(run: () => Promise<void>): Promise<boolean> {
        try {
            await run();

            return true;
        } catch (error) {
            if (!(error instanceof TransportError && error.code === 'rev-conflict')) {
                throw error;
            }

            await fireAndForget('refresh', this.refresh());
            useToasts.getState().show({
                kind: 'error',
                id: 'templates-conflict',
                title: i18next.t('settings:editor.templates.conflict.title'),
                description: i18next.t('settings:editor.templates.conflict.description')
            });

            return false;
        }
    }

    private revisionOf(scope: TemplateScope): number {
        const revision = scope === 'personal' ? this.snapshot?.personal.revision : this.snapshot?.project?.revision;

        if (revision === undefined) {
            throw new Error(`The ${scope} templates are not loaded`);
        }

        return revision;
    }

    private amend(scope: TemplateScope, change: (part: ProjectTemplates) => Partial<ProjectTemplates>): void {
        this.update((current) => {
            if (scope === 'personal') {
                return { ...current, personal: { ...current.personal, ...change(current.personal) } };
            }

            return current.project === null ? current : { ...current, project: { ...current.project, ...change(current.project) } };
        });
    }

    private update(change: (current: TemplatesSnapshot) => TemplatesSnapshot): void {
        if (this.snapshot !== null) {
            this.replace(change(this.snapshot));
        }
    }

    /* The registry is fed on every change, so an editor expands what a person just saved without a reload. */
    protected override replace(next: TemplatesSnapshot | null): void {
        super.replace(next);

        if (next !== null) {
            this.registry.set({
                live: [...next.personal.live, ...(next.project?.live ?? [])].map(liveTemplateOf),
                postfix: [...next.personal.postfix, ...(next.project?.postfix ?? [])].map(postfixTemplateOf),
                disabled: next.personal.disabled,
                settings: next.personal.settings
            });
        }
    }
}

export function useTemplates(tracker: TemplatesTracker): TemplatesSnapshot | null {
    const subscribe = (listener: () => void) => tracker.subscribe(listener);

    return useSyncExternalStore(subscribe, () => tracker.getSnapshot());
}
