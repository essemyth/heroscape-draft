// Small helpers over node:http: JSON bodies and replies, cookies, errors.

import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const badRequest = (message: string) => new HttpError(400, message)
export const forbidden = (message: string) => new HttpError(403, message)
export const notFound = (message = 'Not found') => new HttpError(404, message)

const MAX_BODY = 8 * 1024 * 1024 // photos arrive base64-encoded, ~70 KB each

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'That upload is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw badRequest('Invalid JSON')
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(data)
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** True when the browser reached us over HTTPS (directly or through a proxy/tunnel). */
export function isHttps(req: IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean((req.socket as { encrypted?: boolean }).encrypted)
}
