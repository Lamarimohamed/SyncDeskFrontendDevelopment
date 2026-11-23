import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const isProxiedPath = (pathname) =>
  pathname === '/health' ||
  pathname === '/api' ||
  pathname.startsWith('/api/') ||
  pathname.startsWith('/v1/')

const rewriteUpstreamPath = (urlPath) => {
  if (urlPath === '/api') return '/'
  if (urlPath.startsWith('/api/')) return urlPath.slice(4)
  return urlPath
}

export function createFrontendServer(options = {}) {
  const host = options.host ?? process.env.FRONTEND_HOST ?? '0.0.0.0'
  const port = Number(options.port ?? process.env.FRONTEND_PORT ?? 8443)
  const distDir = resolve(options.distDir ?? process.env.FRONTEND_DIST_DIR ?? 'dist')
  const upstreamBase = (options.backendUpstreamUrl ?? process.env.BACKEND_UPSTREAM_URL ?? 'http://backend:8787').replace(/\/+$/, '')

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = parsedUrl.pathname

    if (method === 'GET' && pathname === '/healthz') {
      const payload = JSON.stringify({ status: 'ok', service: 'syncdesk-frontend' })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(payload),
      })
      res.end(payload)
      return
    }

    if (isProxiedPath(pathname)) {
      const targetPath = rewriteUpstreamPath(pathname) + parsedUrl.search
      const targetUrl = new URL(targetPath, `${upstreamBase}/`)
      const client = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest

      const proxyReq = client(
        targetUrl,
        {
          method,
          headers: {
            ...req.headers,
            host: targetUrl.host,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
          proxyRes.pipe(res)
        },
      )

      proxyReq.on('error', () => {
        if (!res.headersSent) {
          const payload = JSON.stringify({
            error: {
              code: 'backend_unavailable',
              message: 'The upstream synchronization backend is unavailable.',
            },
          })
          res.writeHead(502, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
          })
          res.end(payload)
        } else {
          res.end()
        }
      })

      req.pipe(proxyReq)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Method Not Allowed')
      return
    }

    const safeRelative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '')
    let candidatePath = join(distDir, safeRelative)

    let stat = existsSync(candidatePath) ? statSync(candidatePath) : null
    if (stat && stat.isDirectory()) {
      candidatePath = join(candidatePath, 'index.html')
      stat = existsSync(candidatePath) ? statSync(candidatePath) : null
    }

    // SPA route fallback for routes without a file extension
    if ((!stat || !stat.isFile()) && !extname(safeRelative)) {
      candidatePath = join(distDir, 'index.html')
      stat = existsSync(candidatePath) ? statSync(candidatePath) : null
    }

    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }

    const ext = extname(candidatePath).toLowerCase()
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
    const cacheControl =
      ext === '.html' || pathname === '/sw.js'
        ? 'no-cache'
        : pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600'

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
    })

    if (method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(candidatePath).pipe(res)
  })

  return {
    server,
    host,
    port,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        if (!server.listening) {
          resolveClose()
          return
        }
        server.close((err) => (err ? rejectClose(err) : resolveClose()))
      }),
  }
}

export async function startFrontendServer(options = {}) {
  const frontend = createFrontendServer(options)
  await new Promise((resolveListen, rejectListen) => {
    const onError = (err) => {
      frontend.server.off('listening', onListening)
      rejectListen(err)
    }
    const onListening = () => {
      frontend.server.off('error', onError)
      resolveListen()
    }
    frontend.server.once('error', onError)
    frontend.server.once('listening', onListening)
    frontend.server.listen(frontend.port, frontend.host)
  })
  const addr = frontend.server.address()
  if (addr && typeof addr === 'object') {
    frontend.port = addr.port
  }
  return frontend
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const frontend = await startFrontendServer()
  process.stdout.write(`SyncDesk frontend listening on http://${frontend.host}:${frontend.port}\n`)
  const shutdown = () => {
    void frontend.close().then(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
