import type { AgentKind, ModelInfo } from '@ruimte/contracts';
import { useProviders } from '@/state/providers';

/*
 * A model id as a person reads it, for a model no catalog names: without its vendor prefix and its
 * date, and with the version number put back together (`claude-opus-4-5` is one 4.5, not a 4 and a
 * 5).
 */
export const modelNameFromSlug = (slug: string): string => {
    const bare = slug.slice(slug.lastIndexOf('/') + 1).replace(/-\d{6,8}$/, '');
    const words: string[] = [];
    for (const word of bare.split('-')) {
        const previous = words.at(-1);
        if (previous !== undefined && /^\d+$/.test(word) && /\d$/.test(previous)) {
            words[words.length - 1] = `${previous}.${word}`;
            continue;
        }
        words.push(word);
    }
    return words.map((word) => (word === 'gpt' ? 'GPT' : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
};

/* What the CLI calls the model, so every surface says the same thing; a slug it no longer offers is read as one. */
export const modelName = (slug: string, models: readonly ModelInfo[] | undefined): string =>
    models?.find((entry) => entry.slug === slug)?.name ?? modelNameFromSlug(slug);

/* The same answer for the machine in scope, whose catalog is the only one that can name the slug. */
export const useModelName = (provider: AgentKind | undefined, slug: string): string =>
    useProviders((state) => modelName(slug, state.providers.find((entry) => entry.kind === provider)?.models));
