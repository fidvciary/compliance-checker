import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { checkCompliance, type UploadedFile, type CheckScope } from '../check.js';
import type { SensitivityLevel } from '../config/sensitivity.js';
import type { UploadKind } from '../ingestion/any-file.js';
import { renderIssuesHtml } from '../report/render-html.js';
import { renderAppPage } from './page.js';

/**
 * Dependency-light local server for the checker UI. Serves the single-page app
 * and a POST /api/check endpoint. The browser sends files as base64 JSON; the
 * backend decodes and parses every type. Runs locally — uploaded data (which may
 * include claims) stays on the machine.
 */

const MAX_BODY = 80 * 1024 * 1024; // 80 MB of base64 JSON

interface CheckRequestBody {
  scope?: CheckScope;
  sensitivity?: SensitivityLevel;
  jurisdiction?: string;
  files?: Array<{ name: string; kind?: UploadKind; base64: string }>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Upload too large (limit 80 MB). Split the files or convert to a lighter format.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

async function handleCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: CheckRequestBody;
  try {
    body = JSON.parse(raw) as CheckRequestBody;
  } catch {
    json(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const scope: CheckScope = body.scope === 'everything' ? 'everything' : 'as-written';
  const files: UploadedFile[] = (body.files ?? []).map((f) => ({
    name: f.name,
    bytes: Buffer.from(f.base64, 'base64'),
    ...(f.kind ? { kind: f.kind } : {}),
  }));
  if (files.length === 0) {
    json(res, 400, { error: 'No files uploaded.' });
    return;
  }
  const result = await checkCompliance(files, {
    scope,
    ...(body.sensitivity ? { sensitivity: body.sensitivity } : {}),
    ...(body.jurisdiction ? { jurisdiction: body.jurisdiction } : {}),
  });
  json(res, 200, { html: renderIssuesHtml(result), issueCount: result.issues.length });
}

export interface ServeOptions {
  port?: number;
  host?: string;
}

export function startServer(opts: ServeOptions = {}): ReturnType<typeof createServer> {
  const port = opts.port ?? 4732;
  const host = opts.host ?? '127.0.0.1';
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
          const html = renderAppPage();
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (req.method === 'POST' && req.url === '/api/check') {
          await handleCheck(req, res);
          return;
        }
        if (req.method === 'GET' && req.url === '/health') {
          json(res, 200, { ok: true });
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      } catch (e) {
        json(res, 500, { error: (e as Error).message });
      }
    })();
  });
  server.listen(port, host, () => {
    console.log(`Parity compliance checker running at http://${host}:${port}`);
    console.log('Open that URL in your browser. Uploaded files are processed locally and are not sent anywhere else.');
  });
  return server;
}
