// Starts the server. Configuration comes from environment variables:
//   PORT             default 8787
//   DATA_DIR         default ./data (a persistent volume in production)
//   SITE_DIR         default ./dist (the built site)
//   PHOTO_CODE_HASH  SHA-256 hex of the photo code; photo editing is off without it

import { join } from 'node:path'
import { createApp, projectRoot } from './app.ts'

const port = Number(process.env.PORT ?? 8787)
const { server } = createApp({
  rootDir: projectRoot,
  dataDir: process.env.DATA_DIR ?? join(projectRoot, 'data'),
  siteDir: process.env.SITE_DIR ?? join(projectRoot, 'dist'),
  photoCodeHash: process.env.PHOTO_CODE_HASH ?? '',
})
if (!process.env.PHOTO_CODE_HASH) console.warn('PHOTO_CODE_HASH is not set: no device can unlock photo editing.')

server.listen(port, () => console.log(`HeroScape Draft listening on http://localhost:${port}`))

// Let Kubernetes stop us cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close()
    process.exit(0)
  })
}
