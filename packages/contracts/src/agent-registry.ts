import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/*
 * An agent of the public ACP registry that has a build for the machine's system, and where it stands there. A person's
 * Install puts the version the registry names under `$RUIMTE_HOME`; from then on it is a provider of its own `kind`.
 */
export const RegistryAgentSchema = z.object({
    // The registry's id, which is also the kind it runs as.
    id: z.string(),
    kind: AgentKindSchema,
    name: z.string(),
    // The version the registry names, which Install puts in place.
    version: z.string(),
    description: z.string(),
    website: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    // An archive the machine downloads itself, or a package it installs with npm or uv.
    distribution: z.enum(['binary', 'npm', 'uv']),
    // Whether the registry gives a checksum the download is held to.
    checksum: z.boolean(),
    // The version unpacked here; null before the first Install.
    installed: z.string().nullable(),
    state: z.enum(['missing', 'installing', 'installed', 'failed']),
    // Why the last Install failed, while the state is `failed`.
    error: z.string().optional()
});
export type RegistryAgent = z.infer<typeof RegistryAgentSchema>;

export const RegistryCatalogSchema = z.object({
    // `live` read from the registry within the hour, `cached` the last good catalog after a read failed, `unavailable` none at all.
    source: z.enum(['live', 'cached', 'unavailable']),
    // When the catalog shown was read from the registry, in ms since the epoch.
    fetchedAt: z.number().nullable(),
    // Why the last read failed, while the source is not `live`.
    error: z.string().optional(),
    // The registry's name for the machine's system and architecture (`darwin-aarch64`), null where it has none.
    platform: z.string().nullable(),
    agents: z.array(RegistryAgentSchema)
});
export type RegistryCatalog = z.infer<typeof RegistryCatalogSchema>;

export const RegistryCatalogPayloadSchema = z.object({ refresh: z.boolean().optional() });
export const RegistryCatalogResultSchema = z.object({ catalog: RegistryCatalogSchema });
export const RegistryAgentPayloadSchema = z.object({ id: z.string().min(1) });
export const RegistryAgentResultSchema = z.object({ agent: RegistryAgentSchema });

// How the executable of a CLI came to the machine, read from where it really is.
export const CliInstallMethodSchema = z.enum(['homebrew', 'homebrew-cask', 'npm', 'pnpm', 'bun', 'ruimte', 'unknown']);
export type CliInstallMethod = z.infer<typeof CliInstallMethodSchema>;

/* The version of a CLI on the machine, how it was installed and whether that route has a newer one. */
export const CliVersionSchema = z.object({
    provider: AgentKindSchema,
    method: CliInstallMethodSchema,
    // The formula, cask or package the route knows it by; null where the route names none.
    package: z.string().nullable(),
    // Where the executable is once its links are followed; null while it is not installed.
    path: z.string().nullable(),
    version: z.string().nullable(),
    // The newest version the route offers; null where it names none (a cask without a version) or could not be asked.
    latest: z.string().nullable(),
    // Whether `provider.update` would bring a newer version through the same route.
    updatable: z.boolean(),
    state: z.enum(['idle', 'updating', 'failed']),
    // Why the last look for a newer version or the last update failed.
    error: z.string().optional(),
    // When the route was last asked for its newest version, in ms since the epoch.
    checkedAt: z.number().nullable()
});
export type CliVersion = z.infer<typeof CliVersionSchema>;

export const CliVersionsPayloadSchema = z.object({ provider: AgentKindSchema.optional(), refresh: z.boolean().optional() });
export const CliVersionsResultSchema = z.object({ versions: z.array(CliVersionSchema) });
export const CliUpdatePayloadSchema = z.object({ provider: AgentKindSchema });
export const CliUpdateResultSchema = z.object({ version: CliVersionSchema });

/* Whether every word of a search is in the agent's name, id or description, whatever the case; the app and an agent's catalog search alike. */
export function registryAgentMatches(agent: Pick<RegistryAgent, 'id' | 'name' | 'description'>, search: string): boolean {
    const text = `${agent.name} ${agent.id} ${agent.description}`.toLowerCase();
    return search
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== '')
        .every((word) => text.includes(word));
}
