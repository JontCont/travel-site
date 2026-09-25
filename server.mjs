import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTripApi, openTripDatabase, walkApi } from './route-api.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const distDirectory = resolve(root, 'dist')
const indexPath = resolve(distDirectory, 'index.html')
if (!existsSync(indexPath)) throw new Error('找不到 dist/index.html；請先執行 npm run build。')

const database = openTripDatabase()
if (process.env.TRIP_COOKIE_SECURE === undefined) process.env.TRIP_COOKIE_SECURE = '1'
const tripApi = createTripApi(database)
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  let filePath = resolve(distDirectory, `.${pathname}`)
  if (filePath !== distDirectory && !filePath.startsWith(`${distDirectory}${sep}`)) {
    res.writeHead(404)
    res.end()
    return
  }

  try {
    if (statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html')
    if (!statSync(filePath).isFile()) throw new Error('Not a file')
  } catch {
    if (extname(pathname)) {
      res.writeHead(404)
      res.end()
      return
    }
    filePath = indexPath
  }

  const headers = {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  void tripApi(req, res, () => walkApi(req, res, () => serveStatic(req, res)))
    .catch((error) => {
      if (res.headersSent) {
        res.destroy(error)
        return
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('伺服器發生錯誤。')
      console.error('Request failed:', error)
    })
})

const port = Number(process.env.PORT ?? 4173)
const host = process.env.TRIP_HOST ?? '127.0.0.1'
server.listen(port, host, () => {
  console.log(`Trip site listening on http://${host}:${port}`)
})

function closeServer() {
  server.close(() => database.close())
}

process.on('SIGINT', closeServer)
process.on('SIGTERM', closeServer)
