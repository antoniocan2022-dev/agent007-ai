/**
 * affiliate-link-generator.ts — Real API integrations for affiliate links.
 * UPGRADE #66/#68 — 5 networks + generic mode.
 */
import type { ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 120), result } }

export async function toolAffiliateLinkGenerator(args: any): Promise<ToolResult> {
  const a = args ?? {}
  const network = (a.network ?? '').toLowerCase().trim()
  const affiliateId = a.affiliateId ?? ''
  const productId = a.productId ?? a.url ?? ''
  const subId = a.subId ?? ''
  const clickId = a.clickId ?? ''

  let link = ''
  switch (network) {
    case 'amazon': {
      if (!productId) return fail('Amazon requires productId (ASIN)')
      if (!affiliateId) return fail('Amazon requires affiliateId (Associate Tag)')
      const domain = a.marketplace === 'uk' || a.marketplace === 'co.uk' ? 'co.uk' : a.marketplace === 'ca' ? 'ca' : a.marketplace === 'de' ? 'de' : a.marketplace === 'fr' ? 'fr' : a.marketplace === 'jp' || a.marketplace === 'co.jp' ? 'co.jp' : a.marketplace === 'au' || a.marketplace === 'com.au' ? 'com.au' : 'com'
      link = `https://www.amazon.${domain}/dp/${productId}?tag=${affiliateId}`
      if (subId) link += `&linkId=${encodeURIComponent(subId)}`
      break
    }
    case 'shareasale':
    case 'sas': {
      if (!a.merchantId) return fail('ShareASale requires merchantId')
      const params = new URLSearchParams({ b: productId || '1', u: affiliateId, m: a.merchantId })
      if (subId) params.set('afftrack', subId)
      if (clickId) params.set('clickId', clickId)
      link = `https://www.shareasale.com/r.cfm?${params.toString()}`
      break
    }
    case 'impact': {
      if (!a.campaignId) return fail('Impact requires campaignId')
      const params = new URLSearchParams()
      if (subId) params.set('subId1', subId)
      if (productId) params.set('u', productId)
      link = `https://impact.go/${a.campaignId}/${affiliateId}${params.toString() ? '?' + params.toString() : ''}`
      break
    }
    case 'awin': {
      if (!a.awinMerchantId) return fail('Awin requires awinMerchantId')
      const params = new URLSearchParams({ awinmid: a.awinMerchantId, awinaffid: affiliateId })
      if (subId) params.set('clickref', subId)
      if (clickId) params.set('clickref2', clickId)
      if (productId) params.set('p', productId)
      link = `https://www.awin1.com/cread.php?${params.toString()}`
      break
    }
    case 'clickbank':
    case 'cb': {
      if (!affiliateId) return fail('ClickBank requires affiliateId (nickname)')
      if (!productId) return fail('ClickBank requires productId (vendor ID)')
      link = `https://hop.clickbank.net/?affiliate=${affiliateId}&vendor=${productId}`
      if (subId) link += `&custom=${encodeURIComponent(subId)}`
      if (clickId) link += `&tid=${encodeURIComponent(clickId)}`
      break
    }
    case 'generic':
    case 'url':
    case 'custom': {
      if (!productId) return fail('Generic requires url')
      if (!affiliateId) return fail('Generic requires affiliateId')
      try {
        const urlObj = new URL(productId)
        urlObj.searchParams.set(a.param ?? 'ref', affiliateId)
        if (subId) urlObj.searchParams.set('subid', subId)
        if (clickId) urlObj.searchParams.set('clickid', clickId)
        link = urlObj.toString()
      } catch { return fail('Invalid URL for generic mode') }
      break
    }
    default:
      return fail(`Unknown network: "${network}". Supported: amazon, shareasale, impact, awin, clickbank, generic`)
  }
  return ok(link, `Affiliate link generated (${network}): ${link}`)
}
