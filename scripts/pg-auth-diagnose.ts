/**
 * Raw PostgreSQL wire-protocol auth diagnostic (Bun, zero new dependencies).
 *
 * Purpose: the Supabase pooler rejects our credentials with Prisma P1000.
 * Prisma's translated error does not distinguish "wrong password" from
 * "unknown role" from "pooler routing problem". This script performs the REAL
 * SCRAM-SHA-256 exchange at wire level and prints the server's exact error
 * fields (severity / code / message) — the same information psql would show.
 *
 * Safety: the password is NEVER printed. Connection params come from .env
 * (Bun auto-loads it). Modes:
 *   bun scripts/pg-auth-diagnose.ts session       → DIRECT_URL  (port 5432)
 *   bun scripts/pg-auth-diagnose.ts transaction   → DATABASE_URL (port 6543)
 *   bun scripts/pg-auth-diagnose.ts plain-user    → DIRECT_URL with user "postgres"
 *   bun scripts/pg-auth-diagnose.ts db-direct     → db.<ref>.supabase.co:5432, user "postgres"
 */
import net from 'node:net'
import tls from 'node:tls'
import crypto from 'node:crypto'

type Mode = 'session' | 'transaction' | 'plain-user' | 'db-direct'
const mode = (process.argv[2] as Mode) || 'session'

function envUrl(name: string): string {
  const v = process.env[name]
  if (!v || v.includes('<PASSWORD>')) {
    console.error(`REFUSING: ${name} not configured in .env`)
    process.exit(2)
  }
  return v
}

const source = mode === 'transaction' ? envUrl('DATABASE_URL') : envUrl('DIRECT_URL')
const url = new URL(source)
let host = url.hostname
let port = Number(url.port) || 5432
let user = decodeURIComponent(url.username)
const database = url.pathname.replace(/^\//, '') || 'postgres'
const password = decodeURIComponent(url.password)

if (mode === 'plain-user') user = 'postgres'
if (mode === 'db-direct') {
  const ref = user.includes('.') ? user.split('.')[1] : ''
  if (!ref) { console.error('cannot derive project ref for db-direct'); process.exit(2) }
  host = `db.${ref}.supabase.co`
  port = 5432
  user = 'postgres'
}

console.log(`[diag] mode=${mode} host=${host} port=${port} user=${user} db=${database}`)

function i32(n: number): Buffer { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }

function readExactly(stream: net.Socket | tls.TLSSocket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let got = 0
    const onData = (chunk: Buffer) => {
      chunks.push(chunk); got += chunk.length
      if (got >= n) { cleanup(); resolve(Buffer.concat(chunks)) }
    }
    const onError = (e: Error) => { cleanup(); reject(e) }
    const cleanup = () => { stream.off('data', onData); stream.off('error', onError) }
    stream.on('data', onData); stream.on('error', onError)
  })
}

type PgMsg = { type: string; body: Buffer }
function readMessage(stream: net.Socket | tls.TLSSocket): Promise<PgMsg> {
  return new Promise((resolve, reject) => {
    let header: Buffer | null = null
    const chunks: Buffer[] = []
    let got = 0
    const onData = (chunk: Buffer) => {
      chunks.push(chunk); got += chunk.length
      if (!header && got >= 5) {
        const all = Buffer.concat(chunks)
        header = all.subarray(0, 5)
        const len = header.readInt32BE(1)
        if (got >= 1 + len) { cleanup(); resolve({ type: header.toString('utf8', 0, 1), body: all.subarray(5, 1 + len) }) }
      } else if (header) {
        const len = header.readInt32BE(1)
        if (got >= 1 + len) { cleanup(); resolve({ type: header.toString('utf8', 0, 1), body: Buffer.concat(chunks).subarray(5, 1 + len) }) }
      }
    }
    const onError = (e: Error) => { cleanup(); reject(e) }
    const cleanup = () => { stream.off('data', onData); stream.off('error', onError) }
    stream.on('data', onData); stream.on('error', onError)
  })
}

function parseErrorFields(body: Buffer): string[] {
  const out: string[] = []
  let i = 0
  while (i < body.length) {
    const code = body.toString('utf8', i, i + 1); i += 1
    if (code === '\0') break
    const end = body.indexOf(0, i)
    const value = body.toString('utf8', i, end)
    out.push(`${code}: ${value}`)
    i = end + 1
  }
  return out
}

const HARD_TIMEOUT = 25000
setTimeout(() => { console.error('[diag] TIMEOUT — no response'); process.exit(3) }, HARD_TIMEOUT).unref?.()

async function main() {
  // 1. Plain TCP connect
  const sock = net.connect({ host, port })
  sock.setNoDelay(true)
  await new Promise<void>((res, rej) => { sock.once('connect', () => res()); sock.once('error', rej) })
  console.log(`[tcp] connected ${host}:${port}`)

  // 2. SSLRequest → expect 'S'
  sock.write(Buffer.concat([i32(8), i32(80877103)]))
  const sslByte = await readExactly(sock, 1)
  if (sslByte.toString() !== 'S') {
    console.log(`[ssl] server does NOT support TLS (answered "${sslByte.toString()}") — aborting (Supabase requires TLS)`)
    process.exit(4)
  }

  // 3. TLS upgrade with SNI; chain verified when possible. The sandbox CA
  // store may lack the pooler's root CA (Prisma's engine bundles its own).
  // PGDIAG_INSECURE=1 allows continuing unverified — diagnostic only.
  const insecure = process.env.PGDIAG_INSECURE === '1'
  const tlsSock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: !insecure })
  try {
    await new Promise<void>((res, rej) => { tlsSock.once('secureConnect', () => res()); tlsSock.once('error', rej) })
  } catch (e) {
    if (!insecure) {
      console.log(`[tls] verification failed (${(e as Error).message}) — rerun with PGDIAG_INSECURE=1 to continue unverified`)
      process.exit(10)
    }
    console.log(`[tls] WARNING: proceeding WITHOUT chain verification (${(e as Error).message})`)
  }
  const cert = tlsSock.getPeerCertificate()
  console.log(`[tls] ${tlsSock.getProtocol()} · cert subject CN=${JSON.stringify(cert.subject?.CN)} · issuer O=${JSON.stringify(cert.issuer?.O)}`)

  // 4. StartupMessage (protocol 3.0)
  const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`, 'utf8')
  tlsSock.write(Buffer.concat([i32(8 + params.length), i32(196608), params]))

  // 5. Auth / error loop (full SCRAM-SHA-256 client)
  let clientFirstBare = ''
  for (;;) {
    const msg = await readMessage(tlsSock)
    if (msg.type === 'E') {
      console.log('[server] ERROR fields:')
      for (const line of parseErrorFields(msg.body)) console.log('   ', line)
      tlsSock.destroy(); process.exit(5)
    }
    if (msg.type === 'R') {
      const code = msg.body.readInt32BE(0)
      if (code === 0) { console.log('[auth] AuthenticationOk — CREDENTIALS ACCEPTED'); tlsSock.destroy(); process.exit(0) }
      if (code === 5) { console.log('[auth] server requested MD5 (not SCRAM) — unexpected for Supabase; abort'); tlsSock.destroy(); process.exit(6) }
      if (code === 10) {
        // SASLRequest: list of mechanisms
        const rest = msg.body.subarray(4)
        const mechs: string[] = []
        let i = 0
        while (i < rest.length && rest[i] !== 0) {
          const end = rest.indexOf(0, i); mechs.push(rest.toString('utf8', i, end)); i = end + 1
        }
        console.log(`[auth] server offers SASL mechanisms: ${mechs.join(', ')}`)
        if (!mechs.includes('SCRAM-SHA-256')) { console.log('[auth] no SCRAM-SHA-256 offered; abort'); tlsSock.destroy(); process.exit(7) }

        // SCRAM step 1 — client-first
        const nonce = crypto.randomBytes(18).toString('base64')
        clientFirstBare = `n=${user},r=${nonce}`
        const clientFirst = `n,,${clientFirstBare}`
        const mechName = Buffer.from('SCRAM-SHA-256\0', 'utf8')
        const initResp = Buffer.from(clientFirst, 'utf8')
        tlsSock.write(Buffer.concat([Buffer.from('p', 'utf8'), i32(4 + mechName.length + 4 + initResp.length), mechName, i32(initResp.length), initResp]))
        continue
      }
      if (code === 11) {
        // SASLContinue — server-first: r=...,s=...,i=...
        const serverFirst = msg.body.subarray(4).toString('utf8')
        const m = /^r=([^,]+),s=([^,]+),i=(\d+)$/.exec(serverFirst)
        if (!m) { console.log(`[auth] unexpected SASLContinue payload: ${serverFirst.slice(0, 120)}`); tlsSock.destroy(); process.exit(8) }
        const [, serverNonce, saltB64, iterStr] = m
        console.log(`[scram] challenge received (nonce len ${serverNonce.length}, iterations ${iterStr}) — server KNOWS the auth exchange`)

        // SCRAM step 2 — client-final with proof
        const salt = Buffer.from(saltB64, 'base64')
        const iterations = Number(iterStr)
        const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
        const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest()
        const storedKey = crypto.createHash('sha256').update(clientKey).digest()
        const clientFinalWithoutProof = `c=biws,r=${serverNonce}`
        const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`
        const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest()
        const proof = Buffer.alloc(clientKey.length)
        for (let i = 0; i < clientKey.length; i++) proof[i] = clientKey[i] ^ clientSignature[i]
        const finalMsg = `${clientFinalWithoutProof},p=${proof.toString('base64')}`
        const finalBuf = Buffer.from(finalMsg, 'utf8')
        tlsSock.write(Buffer.concat([Buffer.from('p', 'utf8'), i32(4 + finalBuf.length), finalBuf]))
        console.log('[scram] proof sent — waiting for server verdict...')
        continue
      }
      if (code === 12) {
        console.log('[auth] SASLFinal received — server verified our proof')
        continue
      }
      console.log(`[auth] unhandled auth code ${code}`)
    }
    if (msg.type === 'S' || msg.type === 'K' || msg.type === 'N') {
      // ParameterStatus / BackendKeyData / Notice — ignore
      continue
    }
    if (msg.type === 'Z') { console.log('[auth] ReadyForQuery — AUTHENTICATED'); tlsSock.destroy(); process.exit(0) }
  }
}

main().catch((e) => { console.error('[diag] failed:', (e as Error).message); process.exit(9) })
