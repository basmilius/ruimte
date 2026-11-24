import { useServer } from '@ruimte/extension/client';
import type { BoardwalkServer } from '../server/index';
import { boardOf } from './board';
import { Columns } from './Columns';

export default function BoardView({ params }: { params: { board: string } | undefined }) {
    const server = useServer<BoardwalkServer>();
    const board = server.board.use(params?.board ?? null);

    if (!board.ok) {
        return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{board.error.message}</div>;
    }

    return <Columns board={boardOf(board.value.name, board.value.columns, board.value.cards)} />;
}
