import { useState } from 'react';

export default function MenuWidget() {
    const [count, setCount] = useState(0);

    return (
        <button type="button" onClick={() => setCount(count + 1)}>
            A widget in a menu: {count}
        </button>
    );
}
