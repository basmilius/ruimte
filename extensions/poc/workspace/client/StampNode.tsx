import { useNodeData } from '@ruimte/extension/client';

export default function StampNode() {
    const [data] = useNodeData<{ at: string }>();

    return <div style={{ padding: 8 }}>Made by canvas.createNode at {data.at}</div>;
}
