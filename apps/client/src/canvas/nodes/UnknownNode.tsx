import { CircleQuestionMark } from 'lucide-react';
import { useCanvas } from '@/state/canvas';
import { Icon } from '@/ui/Icon';

/*
 * The body of a node a newer Ruimte made. This version cannot draw what it holds, so the plate says
 * so and names the kind, which is what a person searches the release notes for.
 */
export function UnknownNodePlate({ id }: { id: string }) {
    const kind = useCanvas((s) => {
        const raw = s.nodes[id]?.raw?.kind;
        return typeof raw === 'string' ? raw : null;
    });
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-faint">
            <Icon icon={CircleQuestionMark} size={20} />
            <span className="text-sm">This node needs a newer version of Ruimte</span>
            {kind !== null && <span className="font-mono text-xs">{kind}</span>}
        </div>
    );
}
