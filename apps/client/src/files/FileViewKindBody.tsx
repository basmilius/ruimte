import type { ProjectFileView } from '@ruimte/contracts';
import { FileSurface } from '@/files/FileSurface';

/* No column around it: prose centers itself at 768px inside its own renderer, and code wants every pixel the window has. */
export function FileViewKindBody({ view }: { view: ProjectFileView }) {
    return <FileSurface path={view.path} on="view" />;
}
