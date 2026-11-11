import { petFigure } from './catalog';
import { usePetSprites, type CustomPetSprite } from './custom-sprites';
import type { PetLook } from './paint';
import { usePetSettings } from './pet-settings';
import { agentPetChoice, builtInSprite, petPoolOf, type AgentKind, type PetChoice } from './pet-state';

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

export function usePetPool(): PetChoice[] {
    const setting = usePetSettings((s) => s.petsSets);
    const sprites = usePetSprites((s) => s.sprites);

    return petPoolOf(
        setting,
        sprites.map((sprite) => sprite.id)
    );
}

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
