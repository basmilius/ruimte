export const VISUALS = [
    { id: 'phosphor', name: 'Phosphor', description: 'One signal draws the mark and the word', hint: 'Move to turn the frequency knobs' },
    { id: 'gravity', name: 'Gravity well', description: 'An intelligence that bends space', hint: 'Move to bend the field' },
    { id: 'garden', name: 'Signal garden', description: 'Ideas growing into a living network', hint: 'Move to turn the network' },
    { id: 'warp', name: 'Deep field', description: 'A flight through layers of context', hint: 'Move to steer through space' },
    { id: 'swarm', name: 'Mission swarm', description: 'Independent agents, a shared direction', hint: 'Move to guide the agents' },
    { id: 'aurora', name: 'Thinking in waves', description: 'A continuous flow of intelligence', hint: 'Move to twist the ribbons' },
    { id: 'assembly', name: 'Collective matter', description: 'Small pieces building something bigger', hint: 'Move to open the structure' },
    { id: 'singularity', name: 'Singularity', description: 'A ribbon folding around a point of light', hint: 'Move to bend the loop' },
    { id: 'silk', name: 'Silk engine', description: 'Three strands weave, separate and return', hint: 'Move to untangle the strands' },
    { id: 'bloom', name: 'First light', description: 'An iris unfolding in a travelling wave', hint: 'Move to open the iris' }
] as const;

export type VisualId = (typeof VISUALS)[number]['id'];

export function isVisualId(value: string | null): value is VisualId {
    return VISUALS.some((visual) => visual.id === value);
}
