/**
 * /pods — UPGRADE #97
 * HTML dashboard showing all 7 pods with leaders, members, and real-time status.
 * Owner can click a pod to communicate directly with its leader.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PODS = [
  { id: 'scout', name: 'Intelligence & Research', leader: 'SCOUT', members: ['HUNT', 'QUANTUM'], focus: 'Find opportunities, validate demand, research competitors', color: '#38bdf8', icon: '🔬' },
  { id: 'aurora', name: 'Creation & Design', leader: 'AURORA', members: ['QUILL', 'PRISM', 'VERTEX'], focus: 'Create content, design products, build affiliate funnels', color: '#00f0ff', icon: '🎨' },
  { id: 'echo', name: 'Quality Assurance', leader: 'ECHO', members: ['QA Monitor'], focus: 'Test, verify, score quality, ensure 99% target', color: '#818cf8', icon: '✅' },
  { id: 'forge', name: 'Engineering', leader: 'FORGE', members: ['Developer', 'TRADER'], focus: 'Build, deploy, fix infrastructure, execute trades', color: '#fb923c', icon: '🔧' },
  { id: 'pulse', name: 'Monitoring & Ops', leader: 'PULSE', members: ['External Monitor', 'THE BANKER', 'Performance Analyst'], focus: 'Monitor systems, track KPIs, weekly $ contribution board', color: '#fb7185', icon: '📡' },
  { id: 'developer', name: 'System Health', leader: 'Developer', members: ['QA Monitor', 'External Monitor'], focus: 'Tool health, API monitoring, infrastructure repair', color: '#10b981', icon: '⚙️' },
  { id: 'cybersecurity_r', name: 'Compliance & Security', leader: 'Cybersecurity R', members: ['LEGAL', 'Cybersecurity A', 'THE BANKER'], focus: 'Legal compliance, tax strategy, security auditing', color: '#3b82f6', icon: '🛡️' },
  { id: 'revenue', name: 'Revenue (Passive Income)', leader: 'QUANTUM + AURORA', members: ['TRADER', 'THE BANKER', 'PULSE'], focus: 'Owns all passive income: affiliate, SaaS, yield, digital products. Target: $20K/month, 20% daily growth.', color: '#fbbf24', icon: '💰' },
]

export async function GET() {
  const podsHtml = PODS.map(p => `
    <div class="pod-card" style="border-color: ${p.color}40;" onclick="openPod('${p.id}','${p.leader}','${p.name}')">
      <div class="pod-header" style="background: linear-gradient(135deg, ${p.color}20, ${p.color}05);">
        <div class="pod-icon" style="background: ${p.color}20; border-color: ${p.color}50;">${p.icon}</div>
        <div class="pod-info">
          <h3 style="color: ${p.color};">${p.name}</h3>
          <p>Leader: <strong>${p.leader}</strong></p>
        </div>
        <div class="pod-status">
          <span class="status-dot" style="background: #10b981;"></span>
          <span class="status-text">Ready</span>
        </div>
      </div>
      <div class="pod-body">
        <p class="pod-focus">${p.focus}</p>
        <div class="pod-members">
          ${p.members.map(m => `<span class="member-tag" style="border-color: ${p.color}30;">${m}</span>`).join('')}
        </div>
        <div class="pod-stats">
          <span>677 tools</span>
          <span>${p.members.length + 1} agents</span>
        </div>
        <button class="pod-btn" style="background: ${p.color}15; border-color: ${p.color}40; color: ${p.color};">
          💬 Talk to ${p.leader}
        </button>
      </div>
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="refresh" content="30" />
<title>Agent007 — Pod Dashboard (Upgrade #97)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #050810; color: #e0e7ff; min-height: 100vh; padding: 1rem; }
  .container { max-width: 1300px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 2rem; padding: 1.5rem 0; }
  .header h1 { font-size: 1.875rem; font-weight: 800; background: linear-gradient(90deg, #00f0ff, #a855f7); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
  .header p { color: #7c89b5; font-size: 0.875rem; }
  .header .badge { display: inline-block; margin-top: 0.75rem; padding: 0.25rem 0.75rem; background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.3); border-radius: 9999px; font-size: 0.75rem; color: #00f0ff; font-family: monospace; }
  .pods-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
  .pod-card { background: rgba(255,255,255,0.02); border: 1px solid; border-radius: 0.75rem; overflow: hidden; cursor: pointer; transition: all 0.2s; }
  .pod-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  .pod-header { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .pod-icon { width: 40px; height: 40px; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; border: 1px solid; flex-shrink: 0; }
  .pod-info { flex: 1; min-width: 0; }
  .pod-info h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.15rem; }
  .pod-info p { font-size: 0.75rem; color: #7c89b5; }
  .pod-status { display: flex; align-items: center; gap: 0.35rem; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
  .status-text { font-size: 0.7rem; color: #10b981; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .pod-body { padding: 1rem 1.25rem; }
  .pod-focus { font-size: 0.8rem; color: #a5b4fc; margin-bottom: 0.75rem; line-height: 1.5; }
  .pod-members { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.75rem; }
  .member-tag { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 0.25rem; background: rgba(255,255,255,0.05); border: 1px solid; color: #cfd9f0; }
  .pod-stats { display: flex; gap: 1rem; font-size: 0.7rem; color: #5b6a92; margin-bottom: 0.75rem; }
  .pod-btn { width: 100%; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .pod-btn:hover { filter: brightness(1.2); }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); z-index: 50; display: none; align-items: center; justify-content: center; padding: 1rem; }
  .modal-overlay.active { display: flex; }
  .modal { background: #0a1020; border: 1px solid rgba(0,240,255,0.3); border-radius: 0.75rem; padding: 1.5rem; max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .modal-header h2 { font-size: 1.125rem; color: #00f0ff; }
  .modal-close { background: none; border: none; color: #7c89b5; font-size: 1.5rem; cursor: pointer; }
  .modal-input { width: 100%; padding: 0.75rem; border-radius: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #e0e7ff; font-size: 0.875rem; margin-bottom: 0.75rem; outline: none; }
  .modal-input:focus { border-color: #00f0ff; }
  .modal-send { width: 100%; padding: 0.75rem; border-radius: 0.5rem; background: rgba(0,240,255,0.15); border: 1px solid rgba(0,240,255,0.4); color: #00f0ff; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .modal-send:hover { background: rgba(0,240,255,0.25); }
  .modal-send:disabled { opacity: 0.5; cursor: not-allowed; }
  .modal-response { margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 0.5rem; border-left: 3px solid #00f0ff; font-size: 0.875rem; line-height: 1.6; color: #cfd9f0; white-space: pre-wrap; display: none; }
  .modal-response.active { display: block; }
  .footer { text-align: center; margin-top: 2rem; padding: 1.5rem 0; color: #5b6a92; font-size: 0.75rem; border-top: 1px solid rgba(255,255,255,0.05); }
  .footer a { color: #00f0ff; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🧩 Agent007 — Pod Dashboard</h1>
    <p>7 specialized teams — click any pod to communicate directly with its leader</p>
    <span class="badge"><span style="display:inline-block;width:8px;height:8px;background:#10b981;border-radius:50%;margin-right:4px;animation:pulse 2s infinite;"></span> LIVE • ${new Date().toISOString().slice(0,19)}Z</span>
  </div>

  <div class="pods-grid">
    ${podsHtml}
  </div>

  <div class="footer">
    <p>Agent007 AI • Upgrade #97 — Hybrid Pod Structure • <a href="https://agent007-ai.vercel.app">Dashboard</a> • <a href="/tools-health">Tools Health</a></p>
  </div>
</div>

<!-- Leader Communication Modal -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <div class="modal-header">
      <h2 id="modalTitle">Talk to Leader</h2>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <p style="font-size:0.8rem;color:#7c89b5;margin-bottom:0.75rem;" id="modalPodName"></p>
    <textarea class="modal-input" id="leaderMessage" rows="3" placeholder="Type your message to the leader..."></textarea>
    <button class="modal-send" id="sendBtn" onclick="sendToLeader()">Send to Leader</button>
    <div class="modal-response" id="leaderResponse"></div>
  </div>
</div>

<script>
  let currentLeader = '';
  let currentPodName = '';

  function openPod(leaderId, leaderName, podName) {
    currentLeader = leaderId;
    currentPodName = podName;
    document.getElementById('modalTitle').textContent = '💬 Talk to ' + leaderName;
    document.getElementById('modalPodName').textContent = podName + ' — Leader: ' + leaderName;
    document.getElementById('leaderMessage').value = '';
    document.getElementById('leaderResponse').classList.remove('active');
    document.getElementById('leaderResponse').textContent = '';
    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('leaderMessage').focus();
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
  }

  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  async function sendToLeader() {
    const msg = document.getElementById('leaderMessage').value.trim();
    if (!msg) return;

    const btn = document.getElementById('sendBtn');
    const response = document.getElementById('leaderResponse');

    btn.disabled = true;
    btn.textContent = 'Sending...';
    response.classList.add('active');
    response.textContent = '⏳ Waiting for ' + currentPodName + ' leader...';

    try {
      const res = await fetch('/api/team/' + currentLeader, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      if (data.ok) {
        response.textContent = '🤖 ' + data.leader + ':\n\n' + data.response;
      } else {
        response.textContent = '❌ Error: ' + (data.error || 'Unknown error');
      }
    } catch (e) {
      response.textContent = '❌ Network error: ' + e.message;
    }

    btn.disabled = false;
    btn.textContent = 'Send to Leader';
  }

  document.getElementById('leaderMessage').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendToLeader();
    }
  });
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
