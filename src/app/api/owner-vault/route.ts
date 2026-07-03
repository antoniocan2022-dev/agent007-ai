import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VAULT_DIR = '/home/z/my-project/download/vault'
const OWNER_KEY = 'agent007-owner-vault-key-2024-antonio'

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const keyBuf = Buffer.from(OWNER_KEY, 'utf-8')
  const result = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) {
    result[i] = buf[i] ^ keyBuf[i % keyBuf.length]
  }
  return result.toString('utf-8')
}

/** GET /api/owner-vault?file=FILENAME — download a vault file (auto-decrypted) */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const file = url.searchParams.get('file')
    
    if (!file) {
      // List all vault files
      await fsp.mkdir(VAULT_DIR, { recursive: true })
      const files = (await fsp.readdir(VAULT_DIR)).filter(f => f.endsWith('.enc'))
      return NextResponse.json({ files: files.map(f => ({ name: f, url: `/api/owner-vault?file=${f}` })) })
    }

    const safeFile = path.basename(file)
    const filepath = path.join(VAULT_DIR, safeFile)
    
    try {
      await fsp.access(filepath)
    } catch {
      return NextResponse.json({ error: 'Vault file not found' }, { status: 404 })
    }

    const content = await fsp.readFile(filepath, 'utf-8')
    const data = JSON.parse(content)
    
    // Decrypt
    const decrypted = decrypt(data._encrypted || '')
    
    return new NextResponse(decrypted, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${safeFile.replace('.enc', '.txt')}"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
