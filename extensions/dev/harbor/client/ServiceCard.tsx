import { useProject, useServer, useServerEvent, useStorage } from '@ruimte/extension/client';
import type { HarborServer } from '../server/index';

/* The service this project's shells open in, kept on the machine per project, where `server/` reads it, and which of its launches run. */
export default function ServiceCard() {
    const project = useProject();
    const server = useServer<HarborServer>();
    const services = server.services.use();
    const running = server.running.use(project.id);
    const [chosen, choose] = useStorage<string>(`service:${project.id}`, 'web', 'machine');

    useServerEvent<{ projectId: string }>('harbor.running', ({ projectId }) => {
        if (projectId === project.id) {
            server.running.reload(project.id);
        }
    });

    if (!services.ok) {
        return <div style={{ color: 'var(--text-muted)' }}>Harbor could not list the services.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {services.value.map((service) => (
                <button
                    key={service.name}
                    type="button"
                    style={{ textAlign: 'left' }}
                    aria-pressed={service.name === chosen}
                    onClick={() => choose(service.name)}
                >
                    {service.name === chosen ? `${service.name} (shells open here)` : service.name}
                </button>
            ))}
            {running.ok && running.value.length > 0 && <div style={{ color: 'var(--text-muted)' }}>Running: {running.value.join(', ')}</div>}
        </div>
    );
}
