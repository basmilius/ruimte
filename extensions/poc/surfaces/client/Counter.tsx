import { useStorage } from '@ruimte/extension/client';
import { Button } from '@ruimte/extension/ui';

export default function Counter() {
    const [count, setCount] = useStorage('count', 0);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Stored {count}</span>
            <Button onClick={() => setCount(count + 1)}>Add one</Button>
        </div>
    );
}
