import WebSocket, { WebSocketServer } from 'ws'

/**
 * The live channel.
 *
 * A browser cannot put an Authorization header on a websocket, so the
 * token travels in the query string. It is the same token the rest of the
 * API uses: a session token, or an API key for a machine.
 *
 * Everything here is best effort. If the socket is closed, the browser
 * falls back to asking the API, so nothing breaks when the live channel is
 * unavailable.
 */
export class WebSocketManager {
  constructor() {
    this.clients = new Map() // userId -> Set of WebSocket connections
    this.wss = null
    this.heartbeat = null
    this.authService = null
    this.apiKeyService = null
  }

  /**
   * Attach the live channel to the HTTP server.
   */
  setupWebSocket(server, { authService, apiKeyService } = {}) {
    this.authService = authService || null
    this.apiKeyService = apiKeyService || null

    this.wss = new WebSocketServer({ server, path: '/ws' })

    this.wss.on('connection', (ws, req) => {
      void this.onConnection(ws, req)
    })

    // A socket that has gone quiet is closed, so the list of clients does
    // not grow for ever.
    this.heartbeat = setInterval(() => {
      if (!this.wss) return
      this.wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate()
        ws.isAlive = false
        try {
          ws.ping()
        } catch {
          // The socket is on its way out anyway.
        }
      })
    }, 30000)

    if (this.heartbeat.unref) this.heartbeat.unref()

    return this.wss
  }

  /**
   * Accept a socket only if the person who opened it is signed in.
   */
  async onConnection(ws, req) {
    try {
      const token = new URL(`http://${req.headers.host || 'localhost'}${req.url || ''}`)
        .searchParams.get('token')

      if (!token) {
        ws.close(1008, 'Unauthorized')
        return
      }

      let user = null
      if (this.authService) user = await this.authService.verifyToken(token)
      if (!user && this.apiKeyService) user = await this.apiKeyService.verifyKey(token)

      if (!user || !user.userId) {
        ws.close(1008, 'Unauthorized')
        return
      }

      const userId = user.userId
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set())
      }
      this.clients.get(userId).add(ws)

      ws.userId = userId
      ws.isAlive = true

      ws.on('pong', () => {
        ws.isAlive = true
      })

      ws.on('close', () => {
        const set = this.clients.get(userId)
        if (set) {
          set.delete(ws)
          if (set.size === 0) this.clients.delete(userId)
        }
      })

      ws.on('error', error => {
        console.error('[ws] socket error:', error?.message || error)
      })

      // Let the client know it is connected, so it can stop guessing.
      this.send(ws, 'connected', { userId })
    } catch (error) {
      console.error('[ws] could not accept the connection:', error?.message || error)
      try {
        ws.close(1008, 'Unauthorized')
      } catch {
        // Nothing to do.
      }
    }
  }

  /**
   * Send one message to one socket.
   */
  send(ws, event, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ event, data, timestamp: new Date().toISOString() }))
    } catch (error) {
      console.error('[ws] could not send:', error?.message || error)
    }
  }

  /**
   * Send a message to every socket of one person.
   */
  broadcast(userId, event, data) {
    const connections = this.clients.get(userId)
    if (!connections) return
    for (const ws of connections) {
      this.send(ws, event, data)
    }
  }

  broadcastToAll(event, data) {
    if (!this.wss) return
    for (const ws of this.wss.clients) {
      this.send(ws, event, data)
    }
  }

  // Analysis events
  sendAnalysisStart(userId, analysisId, projectName) {
    this.broadcast(userId, 'analysis:start', { analysisId, projectName })
  }

  sendAnalysisProgress(userId, analysisId, progress, message, stage) {
    this.broadcast(userId, 'analysis:progress', {
      analysisId,
      progress,
      message,
      stage
    })
  }

  sendAnalysisComplete(userId, analysisId, findings, summary) {
    const count = Array.isArray(findings) ? findings.length : Number(findings) || 0
    this.broadcast(userId, 'analysis:complete', {
      analysisId,
      findings: count,
      summary
    })
  }

  sendAnalysisError(userId, analysisId, error) {
    this.broadcast(userId, 'analysis:error', { analysisId, error })
  }

  /**
   * Close the live channel and stop the heartbeat.
   */
  close() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.wss) {
      for (const ws of this.wss.clients) {
        try {
          ws.terminate()
        } catch {
          // Nothing to do.
        }
      }
      this.wss.close()
      this.wss = null
    }
    this.clients.clear()
  }
}

export const wsManager = new WebSocketManager()
