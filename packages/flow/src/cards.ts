import {
    FLOW_BUILT_INS,
    flowCardDefinition,
    type FlowArgDefinition,
    type FlowArgValue,
    type FlowBuiltInKind,
    type FlowCard,
    type FlowCardKind,
    type FlowPort,
    type FlowTokenDefinition
} from '@ruimte/contracts';

/* Whether this card stands for one in the catalog, which is what makes its id worth looking up. */
export const isCatalogCard = (card: FlowCard): boolean => card.kind === 'trigger' || card.kind === 'condition' || card.kind === 'action';

const builtInOf = (card: FlowCard): FlowBuiltInKind | null => (isCatalogCard(card) ? null : (card.kind as FlowBuiltInKind));

/*
 * The ports a card offers, top to bottom on its right edge. A condition has two, an action that can
 * fail has two, everything else that carries a run on has one, and a note has none.
 */
export const portsOf = (card: FlowCard): FlowPort[] => {
    if (card.kind === 'note') {
        return [];
    }
    if (card.kind === 'condition') {
        return ['true', 'false'];
    }
    if (card.kind === 'action') {
        return card.card !== undefined && flowCardDefinition(card.card)?.fails === true ? ['done', 'error'] : ['done'];
    }
    return ['done'];
};

/* A trigger starts a run and never continues one, so nothing may land on it. Nor on a note. */
export const takesInput = (card: FlowCard): boolean => card.kind !== 'trigger' && card.kind !== 'start' && card.kind !== 'note';

/* The cards a run can begin at: one from the catalog that fires, and the start card a person presses. */
export const isTriggerCard = (card: FlowCard): boolean => card.kind === 'trigger' || card.kind === 'start';

/* The fields this card offers, from the catalog or from the table of built-ins. */
export const argsOf = (card: FlowCard): readonly FlowArgDefinition[] => {
    const builtIn = builtInOf(card);
    if (builtIn !== null) {
        return FLOW_BUILT_INS[builtIn].args;
    }
    return card.card === undefined ? [] : (flowCardDefinition(card.card)?.args ?? []);
};

/* What this card hands the cards after it. */
export const tokensOf = (card: FlowCard): readonly FlowTokenDefinition[] => {
    const builtIn = builtInOf(card);
    if (builtIn !== null) {
        return FLOW_BUILT_INS[builtIn].tokens;
    }
    return card.card === undefined ? [] : (flowCardDefinition(card.card)?.tokens ?? []);
};

/* Whether an argument is asked for at all, which depends on what its card holds elsewhere. */
export const argApplies = (card: FlowCard, arg: FlowArgDefinition): boolean => {
    if (arg.when === undefined) {
        return true;
    }
    const other = card.args[arg.when.arg];
    return typeof other === 'string' && arg.when.is.includes(other);
};

/*
 * What a field holds, read as the type the card asked for. A field a person never filled in reads as
 * empty rather than as a refusal: whether a card may run at all is `missingArgsOf`, one place.
 */
export const textArg = (card: FlowCard, name: string): string => {
    const value = card.args[name];
    return value === undefined ? '' : String(value);
};

export const numberArg = (card: FlowCard, name: string, fallback: number): number => {
    const value = card.args[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export const booleanArg = (card: FlowCard, name: string): boolean => card.args[name] === true;

/* The fields this card asks for and does not have, which is what stops it before it runs. */
export const missingArgsOf = (card: FlowCard): string[] =>
    argsOf(card)
        .filter((arg) => arg.optional !== true && argApplies(card, arg) && textArg(card, arg.name).trim() === '')
        .map((arg) => arg.name);

/* A new card of this kind, with every field on its default. */
export const defaultArgsOf = (kind: FlowCardKind, cardId?: string): Record<string, FlowArgValue> => {
    const card: FlowCard = { kind, args: {}, x: 0, y: 0, ...(cardId === undefined ? {} : { card: cardId }) };
    const args: Record<string, FlowArgValue> = {};
    for (const arg of argsOf(card)) {
        if (arg.value !== undefined) {
            args[arg.name] = arg.value;
        }
    }
    return args;
};

/*
 * The port a condition leaves by, given what it worked out. `inverted` is read here and nowhere else,
 * so a run and the editor agree on which line lights up.
 */
export const portForOutcome = (card: FlowCard, outcome: boolean): FlowPort => ((card.inverted === true ? !outcome : outcome) ? 'true' : 'false');
