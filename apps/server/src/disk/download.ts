/* Writes the body at the address to the file. The default streams it; tests answer from memory. */
export type FileDownload = (url: string, destination: string) => Promise<void>;

export const downloadFile: FileDownload = async (url, destination) => {
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }

    await Bun.write(destination, response);
};
