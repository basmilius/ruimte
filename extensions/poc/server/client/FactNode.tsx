import { useNodeData } from '@ruimte/extension/client';

export default function FactNode() {
    const [data] = useNodeData<{ fact: string }>();

    return <div style={{ padding: 8 }}>{data.fact}. Draw a line to a chat and ask it what this node says.</div>;
}
