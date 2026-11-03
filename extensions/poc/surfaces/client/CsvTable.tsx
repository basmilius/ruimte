import type { FileInfo } from '@ruimte/extension/client';

export default function CsvTable({ file }: { file: FileInfo & { text: string | null } }) {
    const rows = (file.text ?? '')
        .trim()
        .split('\n')
        .map((line) => line.split(','));

    return (
        <table style={{ margin: 8 }}>
            <tbody>
                {rows.map((row, index) => (
                    <tr key={index}>
                        {row.map((cell, column) => (
                            <td key={column} style={{ paddingRight: 16 }}>
                                {cell}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
