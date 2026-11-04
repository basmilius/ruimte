import { useNodeData } from '@ruimte/extension/client';

export default function CounterNode() {
    const [data, setData] = useNodeData<{ count: number }>();

    return (
        <button type="button" style={{ width: '100%', height: '100%' }} onClick={() => setData({ count: data.count + 1 })}>
            In the project file: {data.count}
        </button>
    );
}
