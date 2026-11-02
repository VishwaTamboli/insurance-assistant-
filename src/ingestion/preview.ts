import { basename } from 'node:path';
import { chunkPolicy } from './chunk.ts';
import { listPolicyFiles, readPolicyFile } from './policy-file.ts';

// A dry run of ingestion: shows what each policy file turns into,
// without calling Gemini or touching the database. Free to run as often as you like.
//
//   npm run ingest:preview                  one line per policy file
//   npm run ingest:preview -- gold-fr-2026  ...plus every chunk of that file, in full
const showChunksOf = process.argv[2];

for (const path of await listPolicyFiles()) {
  const { header, body, contentHash } = await readPolicyFile(path);
  const chunks = await chunkPolicy(body);
  console.log(
    basename(path).padEnd(22),
    `${header.planCode} ${header.jurisdiction} ${header.version}`.padEnd(20),
    `${header.effectiveFrom} → ${header.effectiveTo ?? 'still in force'}`.padEnd(30),
    `hash ${contentHash.slice(0, 12)}…`,
    ` ${chunks.length} chunks`,
  );

  if (showChunksOf && basename(path).startsWith(showChunksOf)) {
    chunks.forEach((chunk, index) => {
      console.log(`\n── chunk ${index} (${chunk.content.length} chars) ──\n${chunk.content}`);
    });
    console.log();
  }
}
