import { defineNodeContext, defineServer } from '@ruimte/extension/server';
import { BOARDS, type ServiceBoard } from './service';

// A card stored before its data had a version held only its title.
defineNodeContext<{ title: string; column: string; points: number } | string>('card', (node) => [
    { text: typeof node.data === 'string' ? `Card: ${node.data}` : `Card: ${node.data.title} (${node.data.column}, ${node.data.points} points)` }
]);

const api = defineServer({
    async boards() {
        return BOARDS.map((board) => ({ id: board.id, name: board.name, cards: board.cards.length }));
    },
    /* The first board without an id, which is the one a person works on now. */
    async board(id: string | null = null): Promise<ServiceBoard> {
        const board = id === null ? BOARDS[0] : BOARDS.find((each) => each.id === id);

        if (board === undefined) {
            throw new Error(`Boardwalk has no board ${id}`);
        }

        return board;
    }
});

export type BoardwalkServer = typeof api;
export default api;
