import type { Artifacts } from './artifacts.ts';
import { ArtifactError } from './artifact-names.ts';

/*
 * What `read` of an artifact node gives an agent: the version the node shows, its text when its first
 * file is text and what it holds otherwise. Only an artifact of the reader's own project; any other
 * reads as not there, the way `artifact_read` answers.
 */
export async function artifactReport(
    artifacts: Pick<Artifacts, 'read'>,
    projectId: string,
    reference: { id: string; version?: string }
): Promise<string | null> {
    try {
        const { artifact, version, file, text, truncated } = await artifacts.read(projectId, {
            artifactId: reference.id,
            ...(reference.version === undefined ? {} : { versionId: reference.version })
        });
        const head = [
            `artifact\t${artifact.artifactId}\t${version.versionId}\t${version.number}\t${artifact.kind}\t${artifact.title}`,
            reference.version === undefined ? 'follows\tthe latest version' : 'pinned\tthis version, whatever is newer',
            ...version.files.map((entry, index) => `file\t${index}\t${entry.name}\t${entry.mime}\t${entry.size}`)
        ];
        if (text === null) {
            return [...head, `note\t${file.name} is ${file.mime}, which prints no text`].join('\n');
        }
        return [...head, '', text, ...(truncated ? ['', 'truncated\tThe rest of the file is not printed'] : [])].join('\n');
    } catch (error) {
        if (error instanceof ArtifactError) {
            return null;
        }
        throw error;
    }
}
