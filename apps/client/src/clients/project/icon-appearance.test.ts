import { expect, test } from 'bun:test';
import { iconAppearanceFromPixels } from './icon-appearance';

function pixels(...colors: number[][]): Uint8ClampedArray {
    return new Uint8ClampedArray(colors.flat());
}

test('the logo color wins over white paper, black lettering and transparent pixels', () => {
    const image = pixels([255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 255, 0, 0], [231, 0, 11, 255]);
    expect(iconAppearanceFromPixels(image).color).toBe('#e7000b');
});

test('the dominant color is weighted by coverage and opacity', () => {
    expect(iconAppearanceFromPixels(pixels([0, 150, 137, 255], [0, 150, 137, 255], [231, 0, 11, 128])).color).toBe('#009689');
    expect(iconAppearanceFromPixels(pixels([0, 150, 137, 255], [231, 0, 11, 80], [231, 0, 11, 80])).color).toBe('#009689');
});

test('only visible monochrome black artwork is classified as black', () => {
    expect(iconAppearanceFromPixels(pixels([0, 0, 0, 255], [255, 255, 255, 0]))).toEqual({ color: null, black: true });
    expect(iconAppearanceFromPixels(pixels([0, 0, 0, 255], [255, 255, 255, 255])).black).toBe(false);
    expect(iconAppearanceFromPixels(pixels([0, 0, 0, 255], [231, 0, 11, 255])).black).toBe(false);
    expect(iconAppearanceFromPixels(pixels([0, 0, 0, 0])).black).toBe(false);
    expect(iconAppearanceFromPixels(pixels([128, 128, 128, 255])).color).toBeNull();
});
