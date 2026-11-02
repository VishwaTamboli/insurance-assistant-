import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface Chunk {
  content: string;               // what gets embedded and searched: heading path + section text
  metadata: { section: string }; // "3. Treatment abroad > 3.1 Emergency treatment in the territorial area"
}

// Only for sections too long to be one chunk (none of our policies have one, but a PDF
// without headings does). Neighbouring pieces share 150 characters, so a sentence cut
// at the end of one piece is still whole at the start of the next.
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150 });

export async function chunkPolicy(body: string): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for (const { headings, text } of splitIntoSections(body)) {
    const section = headings.join(' > ');
    // A section of 1,000 characters or less comes back as one piece.
    for (const piece of await splitter.splitText(text)) {
      // Put the heading path in the text itself, so both searches can see it.
      // (Text before the first heading, such as a PDF's title page, has no path to add.)
      const content = section ? `${section}\n\n${piece}` : piece;
      chunks.push({ content, metadata: { section } });
    }
  }
  return chunks;
}

// Cuts the policy text at its #, ## and ### headings. A ### section keeps its ## parent:
// "### 3.1 Emergency treatment…" under "## 3. Treatment abroad"
//   → headings ['3. Treatment abroad', '3.1 Emergency treatment…']
function splitIntoSections(body: string) {
  const sections: { headings: string[]; text: string }[] = [];
  let headings: string[] = [];
  let lines: string[] = [];

  function endSection() {
    const text = lines.join('\n').trim();
    // A heading with no text of its own (like "## 3. Treatment abroad", followed straight
    // by "### 3.1") makes no chunk; its title lives on in its subsections' headings.
    if (text) sections.push({ headings, text });
    lines = [];
  }

  for (const line of body.split('\n')) {
    const heading = line.match(/^(#{1,3}) (.+)$/); // "## 4. Pre-authorisation" → ['##', '4. Pre-authorisation']
    if (heading) {
      endSection();
      headings = heading[1] === '###' ? [headings[0], heading[2]] : [heading[2]];
    } else {
      lines.push(line);
    }
  }
  endSection();

  return sections;
}
