import type { AgentKind } from '@ruimte/contracts';
import { petFigure } from '@/pets/catalog';
import { usePetSprites, type CustomPetSprite } from '@/pets/custom-sprites';
import type { PetLook } from '@/pets/paint';
import { agentPetChoice, builtInSprite, petPoolOf, type PetChoice } from '@/pets/pet-state';
import { useSettings } from '@/state/settings';

/*
 * The look a set gives an agent's node: a built-in figure from its pack, the one figure given to its CLI,
 * or the strip a person added, which stands for every agent.
 */
export function lookOf(choice: PetChoice, agent: AgentKind | undefined, sprites: readonly CustomPetSprite[], nodeId: string): PetLook {
    const custom = choice.kind === 'custom' ? sprites.find((sprite) => sprite.id === choice.id) : undefined;

    if (custom !== undefined) {
        return { kind: 'sheet', sprite: custom };
    }

    const figure = choice.kind === 'figure' ? petFigure(choice.id) : undefined;

    if (figure !== undefined) {
        return { kind: 'drawn', sprite: figure };
    }

    return { kind: 'drawn', sprite: builtInSprite(choice.kind === 'built-in' ? choice.set : 'buddies', agent, nodeId) };
}

/* The sets the settings pool holds, the ones a person removed since left out. */
export function usePetPool(): PetChoice[] {
    const setting = useSettings((s) => s.petsSets);
    const sprites = usePetSprites((s) => s.sprites);

    return petPoolOf(
        setting,
        sprites.map((sprite) => sprite.id)
    );
}

/* The look of a node's pet: from the set its agent was given, or else the one the settings pool gives that node. */
export function usePetLook(agent: AgentKind | undefined, nodeId: string): PetLook {
    const sprites = usePetSprites((s) => s.sprites);
    const byAgent = useSettings((s) => s.petsByAgent);
    const pool = usePetPool();
    const choice = agentPetChoice(
        byAgent,
        agent,
        pool,
        sprites.map((sprite) => sprite.id),
        nodeId
    );

    return lookOf(choice, agent, sprites, nodeId);
}
