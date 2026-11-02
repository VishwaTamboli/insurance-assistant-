import type { ReactNode } from 'react';

// A small, dependency-free Markdown subset for model answers. The backend keeps the
// answer text and citation markers as-is; this only turns the safe, expected structures
// (headings, paragraphs, lists and comparison tables) into readable HTML.
export function AnswerMarkdown({ text }: { text: string }) {
  const lines = normalizeMarkdownLines(text);
  const blocks: ReactNode[] = [];
  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // Keep soft line breaks inside a paragraph. The CSS on .answer-markdown p uses
    // white-space: pre-wrap, so the model's intentional line breaks remain visible.
    const value = paragraph.join('\n');
    blocks.push(<p key={`p-${blocks.length}`}><InlineText text={value} /></p>);
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    if (line.trim() === '') { flushParagraph(); index += 1; continue; }

    if (isTable(lines, index)) {
      flushParagraph();
      const rows: string[][] = [splitTableLine(lines[index])];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(splitTableLine(lines[index])); index += 1;
      }
      blocks.push(<MarkdownTable key={`table-${blocks.length}`} rows={rows} />);
      continue;
    }

    const heading = line.match(/^(?:#{1,3}\s+|\*\*)(.+?)(?:\*\*)?$/);
    if (heading && (line.startsWith('#') || line.startsWith('**'))) {
      flushParagraph();
      blocks.push(<h3 key={`h-${blocks.length}`}><InlineText text={heading[1].replace(/\*\*$/, '')} /></h3>);
      index += 1; continue;
    }

    const listItem = parseListItem(line);
    if (listItem) {
      flushParagraph();
      const ordered = listItem.ordered;
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const item = parseListItem(candidate);
        if (!item || item.ordered !== ordered) break;
        items.push(item.text);
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={`list-${blocks.length}`}>{items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}</List>);
      continue;
    }

    // Citation-marked lines are separate answer points, even when the model omitted a
    // blank line. Other adjacent lines become a normal paragraph.
    if (/^\s*\[\d+\]/.test(line) || /^\s*Step\s+\d+:/i.test(line)) {
      flushParagraph();
      blocks.push(<p key={`line-${blocks.length}`}><InlineText text={line} /></p>);
    } else {
      paragraph.push(line);
    }
    index += 1;
  }
  flushParagraph();
  return <div className="answer-markdown">{blocks}</div>;
}

interface ListItem {
  ordered: boolean;
  text: string;
}

// Parse list syntax into a semantic item before rendering. The browser's <ol> owns
// ordered numbering, so the number can never drift after the sentence as plain text.
function parseListItem(line: string): ListItem | null {
  const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  if (numbered) return { ordered: true, text: numbered[1] };
  const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
  if (bullet) return { ordered: false, text: bullet[1] };
  return null;
}

// Models occasionally return a valid Markdown list as one physical line, for example
// "1. first point 2. second point". Split only when a list marker follows whitespace;
// decimals and citation markers such as [1] are left untouched.
export function normalizeMarkdownLines(text: string): string[] {
  const rawLines = text
    .replace(/\r\n/g, '\n')
    .split('\n');

  // Some model responses put the ordinal at the end of the sentence, e.g.
  // "Emergency treatment is covered [1]. 1.". When at least two lines use that
  // pattern, treat it as a malformed ordered list and move each number to the front.
  // Requiring a repeated pattern avoids rewriting ordinary prose such as "see page 1.".
  const trailingNumbers = rawLines.map(line => line.match(/^(.+?)\s+(\d+)[.)]\s*$/));
  const trailingListCount = trailingNumbers.filter(Boolean).length;
  const normalizedLines = trailingListCount >= 2
    ? rawLines.map((line, index) => {
        const match = trailingNumbers[index];
        return match ? `${match[2]}. ${match[1].trim()}` : line;
      })
    : rawLines;

  // Markdown permits blank lines inside a list. Keep those items in one semantic
  // <ol>/<ul>; otherwise React renders two separate <ol>s and the browser restarts
  // numbering at 1. The list item's margin supplies the visible spacing instead.
  const withoutListGaps = normalizedLines.filter((line, index, all) => {
    if (line.trim() !== '') return true;
    const previous = listKind(all[index - 1] ?? '');
    const next = listKind(all[index + 1] ?? '');
    return previous === null || previous !== next;
  });

  return withoutListGaps
    .flatMap(line => {
      const startsAsList = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
      return startsAsList
        ? line.replace(/\s+(?=(?:[-*+]\s+|\d+[.)]\s+))/g, '\n').split('\n')
        : [line];
    });
}

function listKind(line: string): 'ordered' | 'unordered' | null {
  if (/^\s*\d+[.)]\s+/.test(line)) return 'ordered';
  if (/^\s*[-*+]\s+/.test(line)) return 'unordered';
  return null;
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return <>{parts.map((part, index) => part.match(/^\*\*[^*]+\*\*$/)
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part.match(/^\[\d+\]$/)
      ? <span className="citation-marker" key={index}>{part}</span>
      : <span key={index}>{part}</span>)}</>;
}

function isTable(lines: string[], index: number): boolean {
  return index + 1 < lines.length && lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]);
}

function splitTableLine(line: string): string[] {
  return line.trim().replace(/^\|\s*|\s*\|$/g, '').split('|').map(cell => cell.trim());
}

function MarkdownTable({ rows }: { rows: string[][] }) {
  const [header, ...body] = rows;
  return <div className="answer-table-wrap"><table><thead><tr>{header.map((cell, index) => <th key={index}><InlineText text={cell} /></th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineText text={cell} /></td>)}</tr>)}</tbody></table></div>;
}
