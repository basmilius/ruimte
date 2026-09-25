import i18next from 'i18next';
import type { ProviderAccountVariable } from '@ruimte/contracts';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/* One variable as the person edits it, before it is saved. */
export interface VariableDraft {
    /* Keeps a row in place while its name is typed. */
    key: string;
    name: string;
    value: string;
    sensitive: boolean;
    /* The name the machine keeps a sensitive value under, while the value itself is not retyped. */
    kept: string | null;
}

let drafted = 0;
const nextKey = (): string => {
    drafted += 1;
    return `variable-${drafted}`;
};

export const draftsOf = (env: readonly ProviderAccountVariable[] | undefined): VariableDraft[] =>
    (env ?? []).map((variable) => ({
        key: nextKey(),
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive,
        kept: variable.sensitive && variable.valueRedacted === true ? variable.name : null
    }));

export const emptyDraft = (sensitive: boolean): VariableDraft => ({ key: nextKey(), name: '', value: '', sensitive, kept: null });

/*
 * A value the keychain holds only counts under the name it was kept under, and only while it stays
 * sensitive: the machine finds it by that name, and never hands it out to be stored in plain text.
 */
const keepsValue = (draft: VariableDraft): boolean => draft.value === '' && draft.sensitive && draft.kept === draft.name;

/* The first thing that keeps these from being saved, in a sentence; null when they can be. */
export const variablesProblem = (drafts: readonly VariableDraft[]): string | null => {
    const words = (key: string, name: string): string => i18next.t(`settings:providers.account.variables.problem.${key}`, { name });
    const seen = new Set<string>();
    for (const draft of drafts) {
        const name = draft.name.trim();
        if (name === '') {
            return words('noName', '');
        }
        if (!NAME.test(name)) {
            return words('invalidName', name);
        }
        if (seen.has(name)) {
            return words('duplicate', name);
        }
        seen.add(name);
        if (draft.value === '' && !keepsValue({ ...draft, name })) {
            return words('noValue', name);
        }
    }
    return null;
};

/* The variables as `accounts.save` takes them; a kept value goes back empty and redacted, so the machine keeps what it has. */
export const variablesOf = (drafts: readonly VariableDraft[]): ProviderAccountVariable[] =>
    drafts.map((draft) => {
        const name = draft.name.trim();
        if (keepsValue({ ...draft, name })) {
            return { name, value: '', sensitive: true, valueRedacted: true };
        }
        return { name, value: draft.value, sensitive: draft.sensitive };
    });

/* Whether the drafts say something other than what the machine holds. */
export const variablesChanged = (drafts: readonly VariableDraft[], env: readonly ProviderAccountVariable[] | undefined): boolean =>
    JSON.stringify(variablesOf(drafts)) !==
    JSON.stringify((env ?? []).map(({ name, value, sensitive, valueRedacted }) => ({ name, value, sensitive, ...(valueRedacted ? { valueRedacted } : {}) })));
