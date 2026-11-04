export interface FileInfo {
    path: string;
    name: string;
    extension: string;
}

// A path from a Windows machine separates with backslashes, so the name starts after either separator.
export function fileInfoOf(path: string): FileInfo {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = name.lastIndexOf('.');

    return { path, name, extension: dot <= 0 ? '' : name.slice(dot + 1).toLowerCase() };
}
