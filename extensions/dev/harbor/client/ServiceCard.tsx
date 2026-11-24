import { useProject, useServer, useStorage } from '@ruimte/extension/client';
import type { HarborServer } from '../server/index';

/* The service this project's shells open in, kept on the machine per project, where `server/` reads it. */
export default function ServiceCard() {
    const project = useProject();
    const services = useServer<HarborServer>().services.use();
    const [chosen, choose] = useStorage<string>(`service:${project.id}`, 'web', 'machine');

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
        </div>
    );
}
