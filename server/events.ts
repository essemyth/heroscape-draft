// Live updates with Server-Sent Events: clients subscribe to a channel ("draft:<id>",
// "photos") and get every change pushed to them. Replaces Supabase Realtime.

import type { IncomingMessage, ServerResponse } from 'node:http'

const channels = new Map<string, Set<ServerResponse>>()

export function subscribe(req: IncomingMessage, res: ServerResponse, channel: string, initial?: () => [string, unknown][]) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Tell proxies (nginx, Cloudflare) not to buffer the stream.
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n')
  for (const [event, data] of initial?.() ?? []) write(res, event, data)

  let set = channels.get(channel)
  if (!set) channels.set(channel, (set = new Set()))
  set.add(res)

  // Comments keep idle connections from being closed by proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    set!.delete(res)
    if (set!.size === 0) channels.delete(channel)
  })
}

export function publish(channel: string, event: string, data: unknown) {
  for (const res of channels.get(channel) ?? []) write(res, event, data)
}

function write(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}
