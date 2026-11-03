import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { z } from 'zod';
import { providerFor } from '../providers/registry.ts';
import { VerbRefusal } from './verb.ts';

export const modelFlag = z.string().trim().min(1, 'model needs a model id').optional();

export const effortFlag = z.string().trim().min(1, 'effort needs a reasoning effort').optional();

/* The refusals of `selectionForOpening` that are about the effort and not the model, so a team names the field. */
export const EFFORT_REFUSALS: ReadonlySet<string> = new Set(['effort-needs-chat', 'no-effort', 'unknown-choice']);

/* The effort choices of a model and its default; null for a model without the option. */
function effortOf(kind: AgentKind, slug: string): { choices: string[]; defaultChoice: string } | null {
    const option = providerFor(kind)
        .catalog.list()
        .find((model) => model.slug === slug)
        ?.options.find((candidate) => candidate.id === 'effort');
    if (option === undefined || option.type !== 'select') {
        return null;
    }
    return { choices: option.choices.map((choice) => choice.id), defaultChoice: option.defaultChoice };
}

/* `normalize` would quietly swap an effort the model lacks for its default, so it is refused first. */
function requireEffort(kind: AgentKind, slug: string, effort: string): void {
    const offered = effortOf(kind, slug);
    if (offered === null) {
        throw new VerbRefusal('no-effort', `${slug} takes no reasoning effort; leave out the effort`, modelLines(kind));
    }
    if (!offered.choices.includes(effort)) {
        throw new VerbRefusal('unknown-choice', `${effort} is no reasoning effort of ${slug}; it takes ${offered.choices.join(', ')}`, modelLines(kind));
    }
}

export function modelLines(kind: AgentKind): string[] {
    return providerFor(kind)
        .catalog.list()
        .map((model) => {
            const line = `model\t${kind}\t${model.slug}\t${model.name}`;
            const effort = effortOf(kind, model.slug);
            return effort === null ? line : `${line}\teffort ${effort.choices.join(', ')}, default ${effort.defaultChoice}`;
        });
}

/*
 * The selection an opened chat starts with; undefined leaves it to the composer preference when the
 * chat starts. Only the effort is an agent's to choose: the rest of the options stay the person's
 * pick for that model, or the model's defaults, since what they cost is the person's call.
 */
export function selectionForOpening(
    kind: AgentKind,
    chat: boolean,
    model: string | undefined,
    effort: string | undefined,
    preferred: ModelSelection | undefined
): ModelSelection | undefined {
    if (model === undefined && effort === undefined) {
        return undefined;
    }
    if (!chat) {
        throw model === undefined
            ? new VerbRefusal('effort-needs-chat', 'Reasoning effort is supported for chat agents only; omit --terminal or leave out the effort')
            : new VerbRefusal('model-needs-chat', 'Model selection is supported for chat agents only; omit --terminal or leave out the model');
    }
    const catalog = providerFor(kind).catalog;
    const resolved = model === undefined ? catalog.normalize(preferred).model : catalog.resolveModel(model);
    if (resolved === null) {
        throw new VerbRefusal('unknown-model', `${model} is not a known model for ${kind}`, modelLines(kind));
    }
    if (effort !== undefined) {
        requireEffort(kind, resolved, effort);
    }
    // The person's last effort carries over to another model that offers it; normalize drops it otherwise.
    const options = preferred?.model === resolved ? { ...preferred.options } : {};
    const chosen = effort ?? preferred?.options.effort;
    if (chosen !== undefined) {
        options.effort = chosen;
    }
    return catalog.normalize({ model: resolved, options });
}
