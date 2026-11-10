import type { CliVersion, RegistryCatalog } from '@ruimte/contracts';

/* What an agent may read of the CLIs a person installs and updates in Settings, Providers. */
export interface ProviderInstallHost {
    catalog(refresh: boolean): Promise<RegistryCatalog>;
    versions(refresh: boolean): Promise<CliVersion[]>;
}
