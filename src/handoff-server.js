#!/usr/bin/env node
import { createServer } from 'node:http'

/**
 * handoff server: the tiny api the github runner talks to.
 * two routes only:
 *   POST /redeem  { jobId }  + x-appiary-handoff token -> env vars (once)
 *   POST /report  { jobId, status }                        <- runner status callback
 *
 * in production this runs as a backend function on the appiary app; the
 * surface is kept this small on purpose so the deployment is a direct port.
 */

export function createHandoffServer({ vault, pipeline, port = 0 }) {
  if (!vault) throw new Error('handoff server requires the vault')
  if (!pipeline) throw new Error('handoff server requires the pipeline')

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      let body = {}
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch {
        return send(400, { error: 'invalid json' })
      }
      try {
        if (req.method === 'POST' && req.url === '/redeem') {
          const token = String(req.headers['x-appiary-handoff'] ?? '')
          if (!token) return send(401, { error: 'missing handoff token' })
          const env = await vault.redeemHandoff(token, body.jobId)
          return send(200, { env })
        }
        if (req.method === 'POST' && req.url === '/report') {
          if (!body.jobId) return send(400, { error: 'jobId required' })
          const result = await pipeline.reportStatus(body.jobId, body)
          return send(200, result)
        }
        return send(404, { error: 'not found' })
      } catch (err) {
        return send(400, { error: err.message.toLowerCase() })
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port: server.address().port }))
  })
}
