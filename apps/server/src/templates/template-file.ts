import { isRecord } from '@adecore/utils/record';
import {
    LiveTemplateSchema,
    PersonalTemplatesFileSchema,
    PostfixTemplateSchema,
    ProjectTemplatesFileSchema,
    TEMPLATES_VERSION,
    type LiveTemplate,
    type PostfixTemplate,
    type TemplateSettings
} from '@ruimte/contracts';
import { parseVersioned, serializeJson, type JsonDocumentParse } from '../projects/project-files.ts';

/* An entry of a file as it stands, and what this release reads of it; `template` is null for one it cannot read. */
export interface TemplateEntry<T> {
    readonly raw: unknown;
    readonly template: T | null;
}

/*
 * A templates file as read. `top` is the whole object in the order it was read, so a write puts the
 * keys of a later release back where they were, and `settings` keeps the keys this release does not know.
 */
export interface TemplateDocument {
    readonly top: Record<string, unknown>;
    readonly live: readonly TemplateEntry<LiveTemplate>[];
    readonly postfix: readonly TemplateEntry<PostfixTemplate>[];
    readonly disabled: readonly string[];
    readonly settings: Record<string, unknown>;
}

export const EMPTY_TEMPLATES: TemplateDocument = { top: {}, live: [], postfix: [], disabled: [], settings: {} };

function entriesOf<T>(raw: unknown, read: (value: unknown) => T | null): TemplateEntry<T>[] {
    return (Array.isArray(raw) ? raw : []).map((value: unknown) => ({ raw: value, template: read(value) }));
}

function readLive(value: unknown): LiveTemplate | null {
    const parsed = LiveTemplateSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

function readPostfix(value: unknown): PostfixTemplate | null {
    const parsed = PostfixTemplateSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

function parseDocument(text: string, schema: { safeParse(value: unknown): { success: boolean } }): JsonDocumentParse<TemplateDocument> {
    const versioned = parseVersioned(text, TEMPLATES_VERSION);

    if (versioned.kind !== 'value') {
        return versioned;
    }

    const top = versioned.value;

    // JSON that breaks the schema is a person's or a team's file, so it stays where it is.
    if (!schema.safeParse(top).success || !isRecord(top)) {
        return { kind: 'invalid', message: 'The templates file is JSON, but not in the shape of a templates file' };
    }

    return {
        kind: 'ok',
        document: {
            top,
            live: entriesOf(top.live, readLive),
            postfix: entriesOf(top.postfix, readPostfix),
            disabled: Array.isArray(top.disabled) ? top.disabled.filter((id): id is string => typeof id === 'string') : [],
            settings: isRecord(top.settings) ? top.settings : {}
        }
    };
}

export function parsePersonalTemplates(text: string): JsonDocumentParse<TemplateDocument> {
    return parseDocument(text, PersonalTemplatesFileSchema);
}

export function parseProjectTemplates(text: string): JsonDocumentParse<TemplateDocument> {
    return parseDocument(text, ProjectTemplatesFileSchema);
}

/* The text of a file, with every key it was read with in the place it was read. A project file never gets `disabled` or `settings`. */
export function serializeTemplates(document: TemplateDocument, personal: boolean): string {
    const file: Record<string, unknown> = {
        ...document.top,
        version: TEMPLATES_VERSION,
        live: document.live.map((entry) => entry.raw),
        postfix: document.postfix.map((entry) => entry.raw)
    };

    if (personal) {
        file.disabled = document.disabled;
        file.settings = document.settings;
    }

    return serializeJson(file);
}

/* The entries a client sees: the ones this release reads, the first of an id winning. */
export function templatesOf<T extends { id: string }>(entries: readonly TemplateEntry<T>[]): T[] {
    const seen = new Set<string>();
    const templates: T[] = [];

    for (const entry of entries) {
        if (entry.template === null || seen.has(entry.template.id)) {
            continue;
        }

        seen.add(entry.template.id);
        templates.push(entry.template);
    }

    return templates;
}

/* The switches that are set; a value of another type is a file edited by hand and counts as not set. */
export function settingsOf(raw: Record<string, unknown>): TemplateSettings {
    const settings: TemplateSettings = {};

    if (typeof raw.liveInCompletion === 'boolean') {
        settings.liveInCompletion = raw.liveInCompletion;
    }

    if (typeof raw.postfix === 'boolean') {
        settings.postfix = raw.postfix;
    }

    if (typeof raw.postfixInCompletion === 'boolean') {
        settings.postfixInCompletion = raw.postfixInCompletion;
    }

    return settings;
}

/*
 * The raw entry for a saved template: the old entry with the fields of the new one on top, so a key a
 * later release added to it survives. A field the template lacks is taken off the entry.
 */
export function entryRaw(existing: unknown, fields: Record<string, unknown>): Record<string, unknown> {
    const raw: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};

    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) {
            delete raw[key];
        } else {
            raw[key] = value;
        }
    }

    return raw;
}
