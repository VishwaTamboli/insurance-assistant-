import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

// The text of a PDF, all pages joined. What comes out is plain lines: no "##" headings,
// no bold, no blank lines between paragraphs, and lines broken where the page wrapped them.
export async function extractPdfText(path: string): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text };
}

// Turns numbered section lines back into Markdown headings, so chunkPolicy can cut by
// section again:
//   "4. Pre-authorisation"                           → "## 4. Pre-authorisation"
//   "3.1 Emergency treatment in the territorial area" → "### 3.1 Emergency treatment in the territorial area"
// A heading is a short line that starts with a section number and has no full stop at the
// end, so list items such as "4. Experimental or unproven treatment." stay text.
// It's a rule for policies numbered like ours; other layouts need other rules.
export function restoreHeadings(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length > 60 || line.endsWith('.')) return line;
      if (/^\d+\.\d+ \S/.test(line)) return `### ${line}`; // "3.1 Emergency…"
      if (/^\d+\. \S/.test(line)) return `## ${line}`; //     "4. Pre-authorisation"
      return line;
    })
    .join('\n');
}
