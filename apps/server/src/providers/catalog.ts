import type { ModelInfo, ModelOptionDescriptor, ModelSelection } from '@ruimte/contracts';
import manifest from './claude-models.json' with { type: 'json' };

interface Profile {
    options: ModelOptionDescriptor[];
    // Context size per value of the `contextWindow` option, or `*` when the model has one size.
    contextWindowTokens: Record<string, number>;
}

interface ManifestModel {
    slug: string;
    name: string;
    badge?: string;
    profile: string;
    aliases?: string[];
    legacy?: boolean;
}

/*
 * The models a provider offers and what each one can be asked for. Bundled as JSON so a new
 * model is a data change; a profile is only needed for a new combination of options.
 */
export class ModelCatalog {
    readonly defaultModel: string;
    private readonly profiles: Record<string, Profile>;
    private readonly models: ManifestModel[];

    constructor(data: { defaultModel: string; profiles: Record<string, Profile>; models: ManifestModel[] } = manifest as never) {
        this.defaultModel = data.defaultModel;
        this.profiles = data.profiles;
        this.models = data.models;
    }

    list(): ModelInfo[] {
        return this.models.map((model) => ({
            slug: model.slug,
            name: model.name,
            badge: model.badge,
            legacy: model.legacy === true,
            isDefault: model.slug === this.defaultModel,
            options: this.profileOf(model.slug)?.options ?? []
        }));
    }

    /* What a person reads for a model, so an error in a thread names it the way the picker does. */
    nameOf(slug: string): string {
        return this.models.find((entry) => entry.slug === slug)?.name ?? slug;
    }

    /* Accepts a slug or an alias; unknown models answer null so the caller can decide what to do. */
    resolveModel(name: string): string | null {
        const model = this.models.find((entry) => entry.slug === name || entry.aliases?.includes(name));
        return model?.slug ?? null;
    }

    /* Fills in defaults and drops options the model does not have, so a selection is always complete. */
    normalize(selection: Partial<ModelSelection> | undefined): ModelSelection {
        const model = (selection?.model && this.resolveModel(selection.model)) || this.defaultModel;
        const options: ModelSelection['options'] = {};
        for (const descriptor of this.profileOf(model)?.options ?? []) {
            const given = selection?.options?.[descriptor.id];
            if (descriptor.type === 'select') {
                options[descriptor.id] =
                    typeof given === 'string' && descriptor.choices.some((choice) => choice.id === given) ? given : descriptor.defaultChoice;
            } else {
                options[descriptor.id] = typeof given === 'boolean' ? given : descriptor.defaultValue;
            }
        }
        return { model, options };
    }

    contextWindowFor(selection: ModelSelection): number | null {
        const profile = this.profileOf(selection.model);
        if (!profile) {
            return null;
        }
        const chosen = selection.options.contextWindow;
        return (typeof chosen === 'string' ? profile.contextWindowTokens[chosen] : undefined) ?? profile.contextWindowTokens['*'] ?? null;
    }

    private profileOf(slug: string): Profile | undefined {
        const model = this.models.find((entry) => entry.slug === slug);
        return model ? this.profiles[model.profile] : undefined;
    }
}
