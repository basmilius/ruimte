/* The names of the services Harbor knows, which `client/` offers in a project's settings and `server/` describes. */
export const SERVICE_NAMES = ['web', 'api', 'db'] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
