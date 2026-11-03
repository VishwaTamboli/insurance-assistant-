import http from 'node:http';
import { answerQuestion, HttpError, parseAskBody } from './handlers/ask.ts';
import { handleAskStream } from './handlers/stream.ts';

// The API server: a small node:http wrapper around the LangGraph app. REST only for now —
// the SSE endpoint (POST /api/ask/stream) plugs into the same routing in step 2.
// start: npm run api   (or: npx tsx src/api/server.ts)

const PORT = Number(process.env.PORT ?? 8080);

// Read the whole body, refusing anything that isn't a modest JSON object. 10 KB is far
// more than a question, planCode, jurisdiction and a date ever need.
const MAX_BODY_BYTES = 10_000;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim().length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Failed to read the request body.')));
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  if (pathname === '/api/health') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Use GET for /api/health.' });
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname === '/api/ask') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Use POST for /api/ask.' });
      return;
    }
    const input = parseAskBody(await readJsonBody(req));
    const answer = await answerQuestion(input);
    sendJson(res, 200, answer);
    return;
  }

  if (pathname === '/api/ask/stream') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Use POST for /api/ask/stream.' });
      return;
    }
    const input = parseAskBody(await readJsonBody(req));
    await handleAskStream(req, res, input);
    return;
  }

  sendJson(res, 404, { error: 'Not found. Available routes: GET /api/health, POST /api/ask, POST /api/ask/stream.' });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  route(req, res, pathname).catch((error: unknown) => {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(`[api] ${req.method} ${pathname} failed:`, error);
    // The response may already have started if the failure happened mid-stream.
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, 500, { error: 'Something went wrong answering your question. Please try again.' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log('[api] routes: GET /api/health, POST /api/ask, POST /api/ask/stream');
});
