/**
 * test-whatsapp-bridge.ts — exercise the FREE WhatsApp integration.
 *
 * Tests all 3 providers (CallMeBot, Baileys status, wa.me link) WITHOUT
 * requiring real credentials or an actual phone scan.
 */
let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`✅ ${label}`)
    pass++
  } else {
    console.log(`❌ ${label}`)
    fail++
  }
}

async function main() {
  const BASE = 'http://localhost:3000'

  // === 1. GET status (initial) ===
  console.log('\n--- 1. GET /api/whatsapp-bridge (initial status) ---')
  const statusRes1 = await fetch(`${BASE}/api/whatsapp-bridge`)
  const status1 = await statusRes1.json()
  assert(statusRes1.ok, 'GET status returns 200')
  assert(typeof status1.provider === 'string', `Status has provider field (${status1.provider})`)
  assert(typeof status1.whatsappEnabled === 'boolean', 'Status has whatsappEnabled field')
  assert(status1.callmebot !== undefined, 'Status has callmebot object')
  assert(status1.baileys !== undefined, 'Status has baileys object')
  assert(status1.baileys.status === 'disconnected' || status1.baileys.status === 'pending' || status1.baileys.status === 'linked',
    `Baileys status valid (${status1.baileys.status})`)

  // === 2. Set provider to callmebot ===
  console.log('\n--- 2. Set provider to callmebot ---')
  const setProvRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_provider', provider: 'callmebot' }),
  })
  const setProv = await setProvRes.json()
  assert(setProvRes.ok, 'set_provider returns 200')
  assert(setProv.ok === true, `set_provider succeeds (${setProv.message})`)
  assert(setProv.provider === 'callmebot', 'Provider is now callmebot')

  // === 3. Set callmebot credentials ===
  console.log('\n--- 3. Set CallMeBot credentials ---')
  const setCmbRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_callmebot',
      apiKey: '1234567',
      number: '14165551234',
    }),
  })
  const setCmb = await setCmbRes.json()
  assert(setCmbRes.ok, 'set_callmebot returns 200')
  assert(setCmb.ok === true, `set_callmebot succeeds (${setCmb.message})`)

  // === 4. Verify status reflects callmebot ===
  console.log('\n--- 4. Verify status shows callmebot active ---')
  const statusRes2 = await fetch(`${BASE}/api/whatsapp-bridge`)
  const status2 = await statusRes2.json()
  assert(status2.provider === 'callmebot', `Provider is callmebot (${status2.provider})`)
  assert(status2.whatsappEnabled === true, 'WhatsApp is enabled')
  assert(status2.callmebot.number === '14165551234', `CallMeBot number stored (${status2.callmebot.number})`)
  assert(status2.callmebot.apiKey?.includes('••••'), 'CallMeBot API key is masked (•••• prefix)')

  // === 5. Generate wa.me link ===
  console.log('\n--- 5. Generate wa.me link ---')
  const waLinkRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generate_wa_link',
      to: '15145496297',
      message: 'Test from Agent007!',
    }),
  })
  const waLink = await waLinkRes.json()
  assert(waLinkRes.ok, 'generate_wa_link returns 200')
  assert(waLink.ok === true, 'generate_wa_link succeeds')
  assert(waLink.link.includes('wa.me/15145496297'), `Link has phone number (${waLink.link})`)
  assert(waLink.link.includes('Test%20from%20Agent007'), 'Link has URL-encoded message')

  // === 6. Set provider to wa_link ===
  console.log('\n--- 6. Set provider to wa_link ---')
  const setWaLinkRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_provider', provider: 'wa_link' }),
  })
  const setWaLink = await setWaLinkRes.json()
  assert(setWaLinkRes.ok, 'set_provider wa_link returns 200')
  assert(setWaLink.ok === true, 'wa_link provider set')

  // === 7. Set provider to baileys (without starting session) ===
  console.log('\n--- 7. Set provider to baileys ---')
  const setBaileysRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_provider', provider: 'baileys' }),
  })
  const setBaileys = await setBaileysRes.json()
  assert(setBaileysRes.ok, 'set_provider baileys returns 200')
  assert(setBaileys.ok === true, 'baileys provider set')

  // === 8. Reset to none ===
  console.log('\n--- 8. Reset provider to none ---')
  const resetRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_provider', provider: 'none' }),
  })
  const reset = await resetRes.json()
  assert(resetRes.ok, 'set_provider none returns 200')
  assert(reset.ok === true, 'Provider reset to none')

  // === 9. Verify status shows none ===
  console.log('\n--- 9. Verify status shows none ---')
  const statusRes3 = await fetch(`${BASE}/api/whatsapp-bridge`)
  const status3 = await statusRes3.json()
  assert(status3.provider === 'none', `Provider is none (${status3.provider})`)
  assert(status3.whatsappEnabled === false, 'WhatsApp is disabled')

  // === 10. Invalid provider rejected ===
  console.log('\n--- 10. Invalid provider rejected ---')
  const invalidRes = await fetch(`${BASE}/api/whatsapp-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_provider', provider: 'twilio' }),
  })
  const invalid = await invalidRes.json()
  assert(invalidRes.status === 400, 'Invalid provider returns 400')
  assert(invalid.error.includes('Invalid provider'), `Error message correct (${invalid.error})`)

  // === Summary ===
  console.log(`\n${'='.repeat(60)}`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log(`${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
