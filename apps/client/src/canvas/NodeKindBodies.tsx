import { DiagramNode, DiagramPlate } from '@/canvas/nodes/DiagramNode';
import { DrawingNode } from '@/canvas/nodes/DrawingNode';
import { FileNode, FilePlate } from '@/canvas/nodes/FileNode';
import { NoteNode } from '@/canvas/nodes/NoteNode';
import { UnknownNodePlate } from '@/canvas/nodes/UnknownNode';
import { ExtensionNodeBody } from '@/extensions/ExtensionNodeBody';
import type { NodeBodyProps } from '@/registry/node-kinds';
import { useCanvas } from '@/state/canvas';
import { extensionKeyOf } from '@/state/extension-registry';

export function NoteBody({ id, active }: NodeBodyProps) {
    return <NoteNode id={id} focused={active} />;
}

export function DrawingBody({ id }: NodeBodyProps) {
    return <DrawingNode id={id} />;
}

export function DiagramBody({ id, live, renderBody }: NodeBodyProps) {
    return live && renderBody ? <DiagramNode id={id} /> : <DiagramPlate id={id} />;
}

export function FileBody({ id, live, renderBody, focused }: NodeBodyProps) {
    return live && renderBody ? <FileNode id={id} focused={focused} /> : <FilePlate id={id} />;
}

/* A newer Ruimte's node, or the node of an extension: the plate says it is not this version's unless an extension draws it. */
export function UnknownBody({ id }: NodeBodyProps) {
    const raw = useCanvas((s) => {
        const node = s.nodes[id];
        return node?.kind === 'unknown' ? node.raw : undefined;
    });
    const key = raw === undefined ? null : extensionKeyOf(raw);
    return key === null ? <UnknownNodePlate id={id} /> : <ExtensionNodeBody id={id} contributionKey={key} />;
}
