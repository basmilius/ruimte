import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { z } from 'zod';
import { providerFor } from '../providers/registry.ts';
import { VerbRefusal } from './verb.ts';

export const modelFlag = z.string().trim().min(1, 'model needs a model id').optional();

export const modelLines = (kind: AgentKind): string[] =>
    providerFor(kind)
        .catalog.list()
        .map((model) => `model\t${kind}\t${model.slug}\t${model.name}`);

export const selectionForOpening = (kind: AgentKind, chat: boolean, model: string | undefined): ModelSelection | undefined => {
    if (model === undefined) {
        return undefined;
    }
    if (!chat) {
        throw new VerbRefusal('model-needs-chat', 'Model selection is supported for chat agents only; omit --terminal or leave out the model');
    }
    const catalog = providerFor(kind).catalog;
    const resolved = catalog.resolveModel(model);
    if (resolved === null) {
        throw new VerbRefusal('unknown-model', `${model} is not a known model for ${kind}`, modelLines(kind));
    }
    return catalog.normalize({ model: resolved });
};
