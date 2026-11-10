import { describe, expect, test } from 'bun:test';
import { drawsImageMime, imageFormatName, isDelimitedName } from './file-kind';

describe('drawsImageMime', () => {
    test.each(['image/heic', 'image/heif', 'image/png', 'image/avif', 'image/bmp', 'image/x-icon', 'image/svg+xml'])('draws %s', (mime) => {
        expect(drawsImageMime(mime)).toBe(true);
    });

    test.each(['image/tiff', 'application/pdf', 'video/mp4'])('does not draw %s', (mime) => {
        expect(drawsImageMime(mime)).toBe(false);
    });
});

test('an image format is named the way a person knows it', () => {
    expect(imageFormatName('image/heic')).toBe('HEIC');
    expect(imageFormatName('image/tiff')).toBe('TIFF');
});

test('a .csv or .tsv in any case is a delimited file', () => {
    expect(isDelimitedName('cities.csv')).toBe(true);
    expect(isDelimitedName('EXPORT.TSV')).toBe(true);
    expect(isDelimitedName('notes.txt')).toBe(false);
    expect(isDelimitedName('csv')).toBe(false);
});
