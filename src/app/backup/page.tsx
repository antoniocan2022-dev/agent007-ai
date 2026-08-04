/**
 * /backup page — public, no-auth backup download page.
 *
 * Lists the live backup endpoints and provides clickable download
 * links for the JSON and gzipped formats. Generated on-demand by
 * /api/system/vid-backup so the file is ALWAYS up-to-date with the
 * current Vercel deployment.
 */
import Link from 'next/link'

export const dynamic = 'force-static'

const BACKUP_ENDPOINTS = [
  {
    href: '/api/system/vid-backup?format=json',
    title: 'VID Backup — JSON',
    desc: 'Full backup manifest with live Vercel snapshot (portfolio, KPIs, subagents, VID structure). Streamed as a downloadable .json file.',
    size: '~50 KB',
    format: 'JSON',
  },
  {
    href: '/api/system/vid-backup?format=zip',
    title: 'VID Backup — Gzipped JSON',
    desc: 'Same manifest, gzipped for faster download. Decompresses to the same JSON. Best for slow connections or large portfolios.',
    size: '~10 KB compressed',
    format: 'GZIP',
  },
  {
    href: '/api/system/capabilities-download?format=json',
    title: 'Capabilities Manifest — JSON',
    desc: 'Full registry of all 450+ tools, 21 sub-agents, manage actions, and upgrade history. Generated on-demand.',
    size: '~200 KB',
    format: 'JSON',
  },
  {
    href: '/api/system/capabilities-download?format=zip',
    title: 'Capabilities Manifest — Gzipped',
    desc: 'Same capabilities manifest, gzipped for faster download.',
    size: '~40 KB compressed',
    format: 'GZIP',
  },
]

const LIVE_LINKS = [
  { href: 'https://github.com/antoniocan2022-dev/agent007-ai', label: 'Source Code on GitHub' },
  { href: '/api/version', label: 'Live Version Endpoint' },
  { href: '/api/health', label: 'Live Health Check' },
  { href: '/api/system/vid-kpis', label: 'Live VID KPIs' },
  { href: '/api/team/vid?action=status', label: 'VID Pod Status' },
  { href: '/api/system/portfolio', label: 'Live Portfolio' },
  { href: '/api/subagents', label: 'Subagents (21)' },
]

export default function BackupPage() {
  return (
    <main className="min-h-screen bg-black text-[#e0e7ff] p-6 sm:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          <span style={{ color: '#00f0ff' }}>Agent007</span>{' '}
          <span style={{ color: '#a855f7' }}>Backup Center</span>
        </h1>
        <p className="text-sm text-[#9bb5d4] mb-8 leading-relaxed">
          All backups are generated <strong>on-demand</strong> from the live
          Vercel deployment. Every download contains the latest portfolio state,
          KPIs, subagents, and VID structure — never a stale snapshot.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4 neon-text-cyan">Downloadable Backups</h2>
          <div className="space-y-3">
            {BACKUP_ENDPOINTS.map((b) => (
              <a
                key={b.href}
                href={b.href}
                className="block p-4 rounded-lg border transition hover:bg-white/[0.03]"
                style={{
                  borderColor: 'rgba(0,240,255,0.3)',
                  background: 'linear-gradient(135deg, rgba(0,240,255,0.04), rgba(168,85,247,0.04))',
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-[#e0e7ff]">{b.title}</h3>
                  <span
                    className="text-[9px] font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: b.format === 'JSON' ? 'rgba(0,240,255,0.12)' : 'rgba(168,85,247,0.12)',
                      color: b.format === 'JSON' ? '#00f0ff' : '#a855f7',
                      border: `1px solid ${b.format === 'JSON' ? 'rgba(0,240,255,0.35)' : 'rgba(168,85,247,0.35)'}`,
                    }}
                  >
                    {b.format} · {b.size}
                  </span>
                </div>
                <p className="text-[11px] text-[#9bb5d4] leading-relaxed">{b.desc}</p>
                <div className="text-[10px] text-cyan-300 mt-2 font-mono">{b.href}</div>
              </a>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4 neon-text-purple">Live Verification Links</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LIVE_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2.5 rounded-md border border-cyan-400/20 hover:border-cyan-400/50 transition text-[11px] font-mono text-cyan-300 truncate"
              >
                {l.label}
              </a>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4 text-emerald-300">What's Inside</h2>
          <ul className="text-[12px] text-[#cfd9f0] space-y-1.5 leading-relaxed">
            <li>• <strong>Live portfolio state</strong> — every business, MRR, customer count, automation level</li>
            <li>• <strong>VID structure</strong> — mission, leader (full 11-trait personality), 8 members, Chief Venture Scientist, 4 specialists, Venture Score categories, 13-step workflow</li>
            <li>• <strong>All 10 KPIs</strong> — businesses created/validated/launched, revenue, ROI, success rate, time-to-revenue, org learning, enterprise value, Knowledge Transfer Rate</li>
            <li>• <strong>21 subagents</strong> — including the VID Director (rank #2, reports to CEO)</li>
            <li>• <strong>Git commit + Vercel deployment ID</strong> — fully traceable to source</li>
          </ul>
        </section>

        <footer className="text-center text-[10px] text-[#5b6a92] pt-6 border-t border-white/5">
          Agent007 AI · Venture Intelligence Division · Backup generated on-demand from live Vercel deployment
        </footer>
      </div>
    </main>
  )
}
