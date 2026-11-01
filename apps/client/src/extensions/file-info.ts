export interface FileInfo {
    path: string;
    name: string;
    extension: string;
}

export function fileInfoOf(path: string): FileInfo {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');

    return { path, name, extension: dot <= 0 ? '' : name.slice(dot + 1).toLowerCase() };
}
