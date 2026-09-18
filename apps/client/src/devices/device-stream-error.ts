const MAX_STREAM_ERROR_LENGTH = 320;

function cleanStreamError(value: string): string {
    const text = value
        .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const characters = Array.from(text);
    if (characters.length <= MAX_STREAM_ERROR_LENGTH) {
        return text;
    }
    return `${characters.slice(0, MAX_STREAM_ERROR_LENGTH - 1).join('')}…`;
}

export async function streamResponseError(response: Response): Promise<Error> {
    if (response.status === 404) {
        return new Error('The device stream could not be found');
    }
    let detail = '';
    try {
        detail = cleanStreamError(await response.text());
    } catch {
        // The response body is optional error detail; the generic message remains usable.
    }
    return new Error(detail || 'The device could not start streaming');
}
