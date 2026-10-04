import { describe, expect, it } from 'bun:test';
import { fileUriToPath, pathToFileUri } from './uris.ts';

describe('file URIs', () => {
    it('encodes each segment of a POSIX path and decodes it again', () => {
        const uri = pathToFileUri('/Users/bas/My Project/ü#1.ts');
        expect(uri).toBe('file:///Users/bas/My%20Project/%C3%BC%231.ts');
        expect(fileUriToPath(uri)).toBe('/Users/bas/My Project/ü#1.ts');
    });

    it('keeps the drive of a Windows path', () => {
        expect(pathToFileUri('C:\\work\\app.ts')).toBe('file:///C:/work/app.ts');
        expect(fileUriToPath('file:///C:/work/app.ts')).toBe('C:\\work\\app.ts');
    });

    it('reads nothing but file URIs', () => {
        expect(fileUriToPath('https://example.com/a.ts')).toBeNull();
        expect(fileUriToPath('not a uri')).toBeNull();
    });
});
