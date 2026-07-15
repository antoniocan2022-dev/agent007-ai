import { toolAffiliateLinkGenerator } from '../src/lib/affiliate-link-generator'

async function test() {
  console.log('Testing affiliate_link_generator tool...\n')
  
  const amazon = await toolAffiliateLinkGenerator({ network: 'amazon', productId: 'B08N5WRWNW', affiliateId: 'tag-20' })
  console.log('Amazon:', amazon.ok ? '✅' : '❌')
  console.log('  ', amazon.result)
  
  const sas = await toolAffiliateLinkGenerator({ network: 'shareasale', merchantId: '12345', affiliateId: '123456', productId: 'banner1' })
  console.log('ShareASale:', sas.ok ? '✅' : '❌')
  console.log('  ', sas.result)
  
  const impact = await toolAffiliateLinkGenerator({ network: 'impact', campaignId: 'abc123', affiliateId: 'aff456', url: 'https://merchant.com/product' })
  console.log('Impact:', impact.ok ? '✅' : '❌')
  console.log('  ', impact.result)
  
  const awin = await toolAffiliateLinkGenerator({ network: 'awin', awinMerchantId: '1234', affiliateId: '5678', url: 'https://merchant.com/product' })
  console.log('Awin:', awin.ok ? '✅' : '❌')
  console.log('  ', awin.result)
  
  const cb = await toolAffiliateLinkGenerator({ network: 'clickbank', productId: 'vendor123', affiliateId: 'affnick' })
  console.log('ClickBank:', cb.ok ? '✅' : '❌')
  console.log('  ', cb.result)
  
  const generic = await toolAffiliateLinkGenerator({ network: 'generic', url: 'https://example.com/product', affiliateId: 'myid', param: 'ref' })
  console.log('Generic:', generic.ok ? '✅' : '❌')
  console.log('  ', generic.result)
  
  const unknown = await toolAffiliateLinkGenerator({ network: 'unknown', affiliateId: 'test' })
  console.log('Unknown network:', unknown.ok ? '✅ (should be ❌)' : '✅ correctly rejected')
  console.log('  ', unknown.result)
}
test().catch(console.error)
