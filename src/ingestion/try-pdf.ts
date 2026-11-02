import { join } from 'node:path';
import { chunkPolicy, type Chunk } from './chunk.ts';
import { extractPdfText, restoreHeadings } from './pdf-text.ts';
import { policiesDir, readPolicyFile } from './policy-file.ts';

// The PDF path, as a dry run: no Gemini call, no database.
// policies/pdf/gold-fr-2026.pdf is gold-fr-2026.md printed to PDF, without its header.
const { pages, text } = await extractPdfText(join(policiesDir, 'pdf', 'gold-fr-2026.pdf'));
console.log(`gold-fr-2026.pdf: ${pages} pages, ${text.length} characters of text`);

console.log('\n── The extracted text, first 8 lines ──');
console.log(text.split('\n').slice(0, 8).join('\n'));

// 1. As it comes out of the PDF: no headings, so the fallback splitter does all the cutting.
const blind = await chunkPolicy(text);
console.log(`\n── Chunked as it is: ${blind.length} chunks, no headings found ──`);
blind.forEach((chunk, index) => {
  const lines = chunk.content.split('\n');
  console.log(`chunk ${index} (${chunk.content.length} chars)`);
  console.log(`  starts: ${lines[0]}`);
  console.log(`  ends:   ${lines.at(-1)}`);
});

// 2. With the numbered headings turned back into Markdown headings.
const restored = await chunkPolicy(restoreHeadings(text));
console.log(`\n── With headings restored: ${restored.length} chunks ──`);
restored.forEach((chunk, index) => {
  console.log(`chunk ${index}`.padEnd(10), chunk.metadata.section || '(no heading)');
});

// Same sections as the Markdown version? Chunk 0 is skipped in both: the Markdown file's
// title is a "#" heading, while the PDF's title is plain text.
const markdown = await chunkPolicy((await readPolicyFile(join(policiesDir, 'gold-fr-2026.md'))).body);
const sections = (chunks: Chunk[]) => chunks.slice(1).map((chunk) => chunk.metadata.section).join('|');
console.log(`\nSame sections as gold-fr-2026.md: ${sections(restored) === sections(markdown) ? 'yes' : 'no'}`);
