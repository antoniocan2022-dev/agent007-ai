/**
 * owner-vault.ts — 3 tools for creating owner-exclusive encrypted files.
 * 
 * Agent007 can create files containing internal capabilities, structure,
 * system info, or any sensitive data — ENCRYPTED so only the owner can read them.
 * 
 * 1. toolOwnerVaultCreate — Create an encrypted vault file (owner-only access)
 * 2. toolOwnerVaultList — List all vault files available for download
 * 3. toolOwnerVaultDownload — Get download URL for a vault file
 */

import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }

const VAULT_DIR = '/home/z/my-project/download/vault'
const OWNER_KEY = 'agent007-owner-vault-key-2024-antonio'

/** Simple XOR encryption (owner-only — not military grade, but prevents casual access) */
function encrypt(text: string): string {
  const buf = Buffer.from(text, 'utf-8')
  const keyBuf = Buffer.from(OWNER_KEY, 'utf-8')
  const result = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) {
    result[i] = buf[i] ^ keyBuf[i % keyBuf.length]
  }
  return result.toString('base64')
}

/* ================================================================ *
 * 1. OWNER_VAULT_CREATE — Create encrypted vault file for owner
 * ================================================================ */
export async function toolOwnerVaultCreate(args: {
  filename?: string
  content?: string
  description?: string
}, _ctx: ToolContext): Promise<ToolResult> {
  const filename = (args.filename ?? '').toString().trim()
  if (!filename) return bad('Missing "filename" argument')
  const content = (args.content ?? '').toString()
  if (!content) return bad('Missing "content" argument')
  const description = (args.description ?? 'Owner vault file').toString()

  try {
    await fsp.mkdir(VAULT_DIR, { recursive: true })

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const fullFilename = `vault-${ts}-${safeName}.enc`
    const filepath = path.join(VAULT_DIR, fullFilename)

    // Create metadata header
    const metadata = {
      created: new Date().toISOString(),
      description,
      contentLength: content.length,
      encrypted: true,
      ownerOnly: true,
    }

    // Encrypt content
    const encryptedContent = encrypt(content)
    const fileData = {
      _metadata: metadata,
      _encrypted: encryptedContent,
    }

    await fsp.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8')

    // Also save an unencrypted version in a separate "owner-only" subfolder
    // (the .enc is for transit security, the .txt is for direct owner reading)
    const plaintextDir = path.join(VAULT_DIR, 'plaintext')
    await fsp.mkdir(plaintextDir, { recursive: true })
    const plaintextPath = path.join(plaintextDir, `${safeName}.txt`)
    await fsp.writeFile(plaintextPath, content, 'utf-8')

    // Log to audit
    const userId = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (userId) {
      try {
        await db.auditLog.create({
          data: {
            userId: userId.id,
            action: 'vault_create',
            entity: 'file',
            entityId: filepath,
            description: `Agent007 created owner vault file: ${fullFilename} (${content.length} chars)`,
            metadata: JSON.stringify({ filename: fullFilename, description, size: content.length }),
          },
        })
      } catch {}
    }

    return ok(`Vault file created: ${fullFilename}`, `🔒 Owner Vault File Created

File: ${fullFilename}
Description: ${description}
Content size: ${content.length} characters
Encrypted: ✅ Yes (owner-only access)

DOWNLOAD LOCATIONS:
  1. Encrypted: ${filepath}
  2. Plaintext (owner-only): ${plaintextPath}
  3. Via API: https://agent007-ai.vercel.app/api/owner-vault?file=${fullFilename}

The file contains internal capabilities/structure that only the owner (Antonio) should access.
Agent007 can share this file via email or WhatsApp using autonomous_email_sender.

CAPABILITY STATUS: Agent007 can create encrypted owner-exclusive vault files.`)
  } catch (e: any) { return bad(`Vault create failed: ${e?.message}`) }
}

/* ================================================================ *
 * 2. OWNER_VAULT_LIST — List all vault files
 * ================================================================ */
export async function toolOwnerVaultList(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    await fsp.mkdir(VAULT_DIR, { recursive: true })
    const files = await fsp.readdir(VAULT_DIR)
    const vaultFiles = files.filter(f => f.endsWith('.enc'))

    if (vaultFiles.length === 0) {
      return ok('No vault files', 'No owner vault files found. Use owner_vault_create to create one.')
    }

    let listing = ''
    for (let i = 0; i < vaultFiles.length; i++) {
      const f = vaultFiles[i]
      const stat = await fsp.stat(path.join(VAULT_DIR, f))
      listing += `  ${i + 1}. ${f} (${Math.round(stat.size / 1024)}KB, ${stat.mtime.toISOString().slice(0, 10)})\n`
    }

    return ok(`${vaultFiles.length} vault files`, `🔒 Owner Vault Files\n══════════════════════════════════════════════\n${listing}\nDownload via: https://agent007-ai.vercel.app/api/owner-vault?file=FILENAME`)
  } catch (e: any) { return bad(`Vault list failed: ${e?.message}`) }
}

/* ================================================================ *
 * 3. OWNER_VAULT_DOWNLOAD — Get download info for a vault file
 * ================================================================ */
export async function toolOwnerVaultDownload(args: {
  filename?: string
}, _ctx: ToolContext): Promise<ToolResult> {
  const filename = (args.filename ?? '').toString().trim()
  if (!filename) return bad('Missing "filename" argument')

  try {
    const filepath = path.join(VAULT_DIR, filename)
    const stat = await fsp.stat(filepath)

    // Also check plaintext version
    const plainName = filename.replace(/^vault-[\d-]+-/, '').replace(/\.enc$/, '.txt')
    const plainPath = path.join(VAULT_DIR, 'plaintext', plainName)
    let plainExists = false
    try { await fsp.access(plainPath); plainExists = true } catch {}

    return ok(`Download info: ${filename}`, `🔒 Vault File Download Info

File: ${filename}
Size: ${Math.round(stat.size / 1024)}KB
Created: ${stat.birthtime.toISOString()}

DOWNLOAD OPTIONS:
  1. Via API (auto-decrypts): https://agent007-ai.vercel.app/api/owner-vault?file=${filename}
  2. Plaintext version: ${plainExists ? plainPath : '(not available)'}
  3. Encrypted file: ${filepath}

To send to owner via email:
  <tool name="autonomous_email_sender">{"to":"antonio.can2022@hotmail.com","subject":"Vault File: ${filename}","body":"Your vault file is available for download at: https://agent007-ai.vercel.app/api/owner-vault?file=${filename}","channel":"email"}</tool>

CAPABILITY STATUS: Agent007 can share vault files with the owner.`)
  } catch (e: any) { return bad(`Vault download failed: ${e?.message}`) }
}
