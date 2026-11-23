import type { Server } from 'node:http'

export interface FrontendServerOptions {
  host?: string
  port?: number
  distDir?: string
  backendUpstreamUrl?: string
}

export interface FrontendServer {
  server: Server
  host: string
  port: number
  close: () => Promise<void>
}

export function createFrontendServer(options?: FrontendServerOptions): FrontendServer
export function startFrontendServer(options?: FrontendServerOptions): Promise<FrontendServer>
