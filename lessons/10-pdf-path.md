# 10. The PDF path

> **Roadmap step 2, piece 8** · Files: [`src/ingestion/pdf-text.ts`](../src/ingestion/pdf-text.ts),
> [`src/ingestion/try-pdf.ts`](../src/ingestion/try-pdf.ts), [`policies/pdf/gold-fr-2026.pdf`](../policies/pdf/gold-fr-2026.pdf)
> · Run: `npm run try:pdf`

## What we built and why

Real insurers publish policies as PDFs, not Markdown. A PDF stores where to draw each letter on a
page, not "this is a heading", so getting the text out loses the structure our chunker relies on.
This piece extracts the text from a PDF of Gold FR 2026, shows what goes wrong when it's chunked as
is, and gets the sections back.

It's a dry run, like `ingest:preview`: no Gemini call and no database. The PDF is the same policy as
`gold-fr-2026.md` (same plan, country and version), so storing it would just replace the Markdown
version's rows.

## New ideas

### What text extraction loses

The first lines `unpdf` gets out of the PDF:

```
Harbourline Health — Gold Health Plan
(France)
Policy wording, version 2026.1. In force from 1 January 2026.
Made-up policy for a learning project. Harbourline Health is not a real insurer.
1. Definitions
You / the member: the person named on the Certificate of Insurance.
```

| In the Markdown file | In the extracted text |
|---|---|
| `## 1. Definitions` | `1. Definitions`: just another line |
| a blank line between paragraphs | nothing: every line ends with a single line break |
| one line per paragraph | lines broken wherever the page wrapped them, even the title |
| `**You / the member:**` in bold | plain text |
| the front-matter header (plan, dates…) | gone: it was never printed. In a real system, those come from whoever uploads the PDF |

### The chunk-boundary problem, for real

Our chunker finds no `#` headings, so the whole policy becomes one section with no heading, and the
fallback splitter (1,000 characters, 150 overlap) does all the cutting. Page 04 warned about this. Here
it is happening:

```
chunk 2 … ends:   or the hospital must notify Harbourline Assistance within 48 hours of the emergency
chunk 3   starts: or the hospital must notify Harbourline Assistance within 48 hours of the emergency
```

The emergency rule is cut mid-sentence. The 150-character overlap repeats the cut line, but the rest
(`If we are not notified within 48 hours, we reduce the amount we pay … by 20%`) lands in chunk 3,
next to Out-patient, Maternity and Waiting periods, with no "Pre-authorisation" heading anywhere in
it. And no chunk has a `section`, so nothing could be cited as "4. Pre-authorisation".

### Getting the headings back

Our policies number their sections, so a numbered line that looks like a title is a heading:

| Line from the PDF | Rule | Becomes |
|---|---|---|
| `4. Pre-authorisation` | short, starts `N. `, no full stop at the end | `## 4. Pre-authorisation` |
| `3.1 Emergency treatment in the territorial area` | short, starts `N.N ` | `### 3.1 Emergency treatment…` |
| `4. Experimental or unproven treatment.` | ends with a full stop: a list item | unchanged |

After that, the same `chunkPolicy` gives the same 14 sections as the Markdown file. The rule fits
policies numbered like ours. Other layouts need other rules: for example, pdf.js also reports each
line's font size, and headings are usually bigger.

### An edge case the PDF path exposed

`chunkPolicy` put `"${section}\n\n"` in front of every chunk. Text before the first heading (all of
it, in the blind PDF case) has no section, so those chunks started with two blank lines. Now a chunk
gets the heading line only when there is one. The Markdown policies are unaffected: their text always
starts with a `#` title.

## Packages

| Package | What it's for |
|---|---|
| `unpdf` (1.9.1) | text extraction from PDFs, built on Mozilla's pdf.js (the PDF reader inside Firefox); no dependencies of its own. Version 2 needs Node 24 |

| Package method | What it does |
|---|---|
| `getDocumentProxy(bytes)` | opens a PDF from its raw bytes (a `Uint8Array`) |
| `extractText(pdf, { mergePages: true })` | returns `{ totalPages, text }`, with all pages joined into one string |

## Our code

| Part | What it does |
|---|---|
| `extractPdfText(path)` | reads the file, opens it with `unpdf`, returns `{ pages, text }` |
| `restoreHeadings(text)` | turns numbered heading lines back into `##` / `###` Markdown headings |
| `chunk.ts` | adds the heading line only when a chunk has a section |
| `try-pdf.ts` | prints the extracted text, the blind chunks (first and last line of each), the restored chunks, and whether the sections match the Markdown file |
| `policies/pdf/gold-fr-2026.pdf` | `gold-fr-2026.md` printed to PDF without its header. `ingest` ignores the `pdf/` folder: it only reads `.md` files in `policies/` |

**How it would join real ingestion:** for a PDF, `readPolicyFile` would take its body from
`restoreHeadings(text)`, its hash from the PDF's bytes, and its header (plan, country, dates) from
wherever the PDF came from, such as an upload form. Everything after that (chunk → embed → store)
stays the same.

## Run it

```bash
npm install unpdf@1.9.1
npm run try:pdf
```

**Expected:** `added 1 package` from the install, then:

```
gold-fr-2026.pdf: 3 pages, 4407 characters of text

── The extracted text, first 8 lines ──
Harbourline Health — Gold Health Plan
(France)
Policy wording, version 2026.1. In force from 1 January 2026.
Made-up policy for a learning project. Harbourline Health is not a real insurer.
1. Definitions
You / the member: the person named on the Certificate of Insurance.
Home country: France, including its overseas departments.
Territorial area: the member states of the European Union, the European Economic

── Chunked as it is: 6 chunks, no headings found ──
chunk 0 (963 chars)
  starts: Harbourline Health — Gold Health Plan
  ends:   We pay 100% of the cost of in-patient hospital treatment in France, including surgery,
chunk 1 (974 chars)
  starts: 2. Hospital benefits in France
  ends:   Emergency treatment in the rest of the world, excluding the United States of America, is
chunk 2 (930 chars)
  starts: 3.2 Emergency treatment outside the territorial area
  ends:   or the hospital must notify Harbourline Assistance within 48 hours of the emergency
chunk 3 (928 chars)
  starts: or the hospital must notify Harbourline Assistance within 48 hours of the emergency
  ends:   We do not pay for:
chunk 4 (927 chars)
  starts: period of 3 months from the start of your membership. Maternity has a waiting period of
  ends:   10. Important information
chunk 5 (245 chars)
  starts: at the exchange rate on the date of treatment.
  ends:   treatment. Contact Harbourline Assistance to confirm cover before planned treatment.

── With headings restored: 14 chunks ──
chunk 0    (no heading)
chunk 1    1. Definitions
chunk 2    2. Hospital benefits in France
chunk 3    3. Treatment abroad > 3.1 Emergency treatment in the territorial area
chunk 4    3. Treatment abroad > 3.2 Emergency treatment outside the territorial area
chunk 5    3. Treatment abroad > 3.3 Planned treatment abroad
chunk 6    3. Treatment abroad > 3.4 Medical repatriation
chunk 7    4. Pre-authorisation
chunk 8    5. Out-patient benefits
chunk 9    6. Maternity
chunk 10   7. Waiting periods
chunk 11   8. Exclusions
chunk 12   9. Making a claim
chunk 13   10. Important information

Same sections as gold-fr-2026.md: yes
```

### What to notice

1. **Chunk boundaries fall mid-sentence and mid-section**: chunks 2/3 split the 48-hour rule; chunks 3/4
   repeat part of Waiting periods because of the overlap.
2. **Each blind chunk mixes 3–5 topics**, so its embedding means "a bit of everything", the same blur
   that made "the whole policy as one chunk" a bad idea on page 04.
3. **Restored, chunk 0 has no heading**: the PDF's title is plain text, while the Markdown file's was a
   `#` heading. Everything after it matches.

## Check yourself

<details>
<summary>Why does the blind PDF text give 6 chunks, while the Markdown file gives 14?</summary>

No `#` headings means one big section, and the fallback splitter cuts it into pieces of up to 1,000
characters: 4,407 characters make 6 pieces (overlap included).
</details>

<details>
<summary>Why doesn't <code>restoreHeadings</code> turn "4. Experimental or unproven treatment." into a heading?</summary>

It ends with a full stop, so it's treated as a list item. Headings in our policies never end with one.
</details>

<details>
<summary>The PDF has no front-matter. Where would plan, country and dates come from in a real system?</summary>

From outside the PDF: whoever uploads it (a form, or a file of metadata next to it). Extraction only
gives you the text.
</details>

---

[← The recall check](09-recall-check.md) · [Index](README.md) · [Next: the first graph →](11-first-graph.md)
