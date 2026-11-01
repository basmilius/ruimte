import type { AgentKind } from '@ruimte/contracts';
import { petFigure } from '@extensions/pets/client/catalog';
import { usePetSprites, type CustomPetSprite } from '@extensions/pets/client/custom-sprites';
import type { PetLook } from '@extensions/pets/client/paint';
import { agentPetChoice, builtInSprite, petPoolOf, type PetChoice } from '@extensions/pets/client/pet-state';
import { usePetSettings } from '@extensions/pets/client/pet-settings';

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
    const setting = usePetSettings((s) => s.petsSets);
    const sprites = usePetSprites((s) => s.sprites);

    return petPoolOf(
        setting,
        sprites.map((sprite) => sprite.id)
    );
}

/* The look of a node's pet: from the set its agent was given, or else the one the settings pool gives that node. */
export function usePetLook(agent: AgentKind | undefined, nodeId: string): PetLook {
    const sprites = usePetSprites((s) => s.sprites);
    const byAgent = usePetSettings((s) => s.petsByAgent);
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
