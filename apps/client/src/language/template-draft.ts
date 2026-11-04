import { checkTemplate, type LiveTemplateDraft, type TemplateLanguage, type TemplatePlace } from '@adecore/editor-react';
import type { LiveTemplate, PostfixTemplate, TemplateScope } from '@ruimte/contracts';
import { isFamily, isPlace, type TemplateInput } from './templates';

/* A template as the dialog edits it. The kind of an existing template never changes. */
export interface TemplateDraft {
    /* Absent for a template that is not saved yet. */
    id?: string;
    kind: 'live' | 'postfix';
    scope: TemplateScope;
    key: string;
    description: string;
    body: string;
    languages: TemplateLanguage[];
    /* Live templates only. */
    places: TemplatePlace[];
    /* Postfix templates only. */
    expression: 'any' | 'statement';
    /* Kept as stored; the dialog has no field for it. */
    example?: string;
}

/* The id the check needs before the machine has given the template one. */
const UNSAVED_ID = 'unsaved';

export function emptyDraft(kind: TemplateDraft['kind']): TemplateDraft {
    return {
        kind,
        scope: 'personal',
        key: '',
        description: '',
        body: '',
        languages: kind === 'live' ? ['javascript'] : ['javascript', 'typescript'],
        places: ['code'],
        expression: 'any'
    };
}

/* What Save as Live Template hands over: the selection as a body, for the person to name. */
export function draftOfSelection(selection: LiveTemplateDraft): TemplateDraft {
    return { ...emptyDraft('live'), body: selection.body, languages: [...selection.languages], places: [...selection.places] };
}

/* What a stored template and a built-in one have in common. */
type LiveFields = Pick<LiveTemplate, 'id' | 'key' | 'body' | 'description'> & { languages: readonly string[]; places?: readonly string[] };

type PostfixFields = Pick<PostfixTemplate, 'id' | 'key' | 'body' | 'description' | 'example' | 'expression'> & { languages: readonly string[] };

export function draftOfLive(template: LiveFields, scope: TemplateScope): TemplateDraft {
    return {
        ...emptyDraft('live'),
        id: template.id,
        scope,
        key: template.key,
        description: template.description ?? '',
        body: template.body,
        languages: template.languages.filter(isFamily),
        places: (template.places ?? ['code']).filter(isPlace)
    };
}

export function draftOfPostfix(template: PostfixFields, scope: TemplateScope): TemplateDraft {
    return {
        ...emptyDraft('postfix'),
        id: template.id,
        scope,
        key: template.key,
        description: template.description ?? '',
        body: template.body,
        languages: template.languages.filter(isFamily),
        expression: template.expression ?? 'any',
        ...(template.example === undefined ? {} : { example: template.example })
    };
}

/* A built-in is never changed: a person edits a copy of their own, which gets an id of its own when saved. */
export function copyOf(draft: TemplateDraft): TemplateDraft {
    const copy: TemplateDraft = { ...draft, scope: 'personal' };
    delete copy.id;

    return copy;
}

/* What the machine is asked to save, with the id of a template that already has one. */
export function inputOf(draft: TemplateDraft): TemplateInput {
    const description = draft.description.trim();
    const shared = {
        ...(draft.id === undefined ? {} : { id: draft.id }),
        key: draft.key,
        body: draft.body,
        ...(description === '' ? {} : { description }),
        languages: draft.languages
    };

    if (draft.kind === 'live') {
        return { kind: 'live', template: { ...shared, places: draft.places } };
    }

    return {
        kind: 'postfix',
        template: { ...shared, expression: draft.expression, ...(draft.example === undefined ? {} : { example: draft.example }) }
    };
}

/* Why the draft cannot be saved, in the editor's own words, or null. */
export function problemOf(draft: TemplateDraft): string | null {
    const shared = { id: draft.id ?? UNSAVED_ID, key: draft.key, body: draft.body, languages: draft.languages };

    return draft.kind === 'live'
        ? checkTemplate({ ...shared, places: draft.places }, 'live')
        : checkTemplate({ ...shared, expression: draft.expression }, 'postfix');
}
