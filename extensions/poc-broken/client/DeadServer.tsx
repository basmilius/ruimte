import { useServer } from '@ruimte/extension/client';

export default function DeadServer() {
    const server = useServer<{ anything(): Promise<string> }>();

    return (
        <button type="button" onClick={() => void server.anything()}>
            Call it, three times to reach crashed
        </button>
    );
}
