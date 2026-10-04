import type { ModelCatalogData, ModelCatalogProfile, ModelInfo, ModelSelection } from '@ruimte/agent-contracts';
import manifest from './claude-models.json' with { type: 'json' };

// What a host builds a catalog from; one that is never replaced needs no date.
export type ModelCatalogInput = Omit<ModelCatalogData, 'updatedAt'> & { updatedAt?: string };

function timeOf(data: ModelCatalogInput): number {
    return data.updatedAt === undefined ? 0 : Date.parse(data.updatedAt);
}

/*
 * The models a provider offers and what each one can be asked for. Bundled as JSON so a new
 * model is a data change; a profile is only needed for a new combination of options. A host may
 * swap in a newer copy while it runs, never one older than the copy it was built with.
 */
export class ModelCatalog {
    private readonly shippedAt: number;
    private data: ModelCatalogInput;

    constructor(data: ModelCatalogInput = manifest as never) {
        this.shippedAt = timeOf(data);
        this.data = data;
    }

    get defaultModel(): string {
        return this.data.defaultModel;
    }

    /* Takes a validated copy unless it is older than the shipped one; answers whether the models changed. */
    replace(data: ModelCatalogData): boolean {
        if (timeOf(data) < this.shippedAt) {
            return false;
        }
        const changed = JSON.stringify(data) !== JSON.stringify(this.data);
        this.data = data;
        return changed;
    }

    list(): ModelInfo[] {
        return this.data.models.map((model) => ({
            slug: model.slug,
            name: model.name,
            badge: model.badge,
            legacy: model.legacy === true,
            isDefault: model.slug === this.data.defaultModel,
            options: this.profileOf(model.slug)?.options ?? []
        }));
    }

    /* What a person reads for a model, so an error in a thread names it the way the picker does. */
    nameOf(slug: string): string {
        return this.data.models.find((entry) => entry.slug === slug)?.name ?? slug;
    }

    /* Accepts a slug or an alias; unknown models answer null so the caller can decide what to do. */
    resolveModel(name: string): string | null {
        const model = this.data.models.find((entry) => entry.slug === name || entry.aliases?.includes(name));
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

    private profileOf(slug: string): ModelCatalogProfile | undefined {
        const model = this.data.models.find((entry) => entry.slug === slug);
        return model ? this.data.profiles[model.profile] : undefined;
    }
}
