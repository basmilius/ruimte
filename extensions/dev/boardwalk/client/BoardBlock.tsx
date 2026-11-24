import { parseBoard } from './board';
import { Columns } from './Columns';

export default function BoardBlock({ source }: { source: string }) {
    return <Columns board={parseBoard(source)} />;
}
