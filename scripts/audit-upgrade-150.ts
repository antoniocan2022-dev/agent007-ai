/**
 * UPGRADE #150 Verification Audit — Product Fulfillment MVP
 */
import * as fs from 'fs'
import * as path from 'path'

const baseDir = '/home/z/my-project'

interface Check {
  name: string
  file: string
  pattern: RegExp
  found: boolean
}

const checks: Check[] = [
  // Fulfillment module
  {
    name: 'product-fulfillment.ts exists',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /export async function fulfillPurchase/,
    found: false,
  },
  {
    name: 'PRODUCTS catalog with 3 products',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /'50-ai-tools-guide'[\s\S]*?'affiliate-blog-network-kit'[\s\S]*?'saas-micro-tool-blueprint'/,
    found: false,
  },
  {
    name: 'CHECKOUT_ALLOW_LIST only has 50-ai-tools-guide',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /CHECKOUT_ALLOW_LIST = new Set<string>\(\[\s*'50-ai-tools-guide'[\s\S]*?\]\)/,
    found: false,
  },
  {
    name: 'Signed URL expiry = 7 days',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /7 \* 24 \* 60 \* 60 \* 1000/,
    found: false,
  },
  {
    name: 'generateDownloadUrl creates per-customer token',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /function generateToken/,
    found: false,
  },
  {
    name: 'validateDownloadToken checks revoked + expiry',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /if \(data\.revoked\) return null[\s\S]*?if \(new Date\(data\.expiresAt\)/,
    found: false,
  },
  {
    name: 'sendFulfillmentEmail uses existing sendEmail',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /await sendEmail\(\{ to, subject, body, type: 'product_fulfillment' \}\)/,
    found: false,
  },
  {
    name: 'logSaleMilestone logs to audit trail',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /missionId: 'first_real_customer'/,
    found: false,
  },
  {
    name: 'checkIsFirstSale queries audit log',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /async function checkIsFirstSale/,
    found: false,
  },
  {
    name: 'Telegram notification on first sale',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /FIRST REAL CUSTOMER/,
    found: false,
  },
  {
    name: 'Warns when BLOB_READ_WRITE_TOKEN not set',
    file: 'src/lib/product-fulfillment.ts',
    pattern: /BLOB_READ_WRITE_TOKEN not set/,
    found: false,
  },

  // Webhook integration
  {
    name: 'Webhook calls fulfillPurchase on checkout.session.completed',
    file: 'src/app/api/webhooks/stripe/route.ts',
    pattern: /fulfillPurchase\(\{[\s\S]*?customerEmail,[\s\S]*?productId,[\s\S]*?amount,[\s\S]*?transactionId/,
    found: false,
  },
  {
    name: 'Webhook revokes tokens on charge.refunded',
    file: 'src/app/api/webhooks/stripe/route.ts',
    pattern: /Revoked download token.*refunded transaction/,
    found: false,
  },
  {
    name: 'Webhook returns fulfilled + isFirstSale flags',
    file: 'src/app/api/webhooks/stripe/route.ts',
    pattern: /fulfilled: !!fulfillmentResult\.downloadUrl[\s\S]*?isFirstSale/,
    found: false,
  },

  // Checkout allow-list
  {
    name: 'Checkout uses CHECKOUT_ALLOW_LIST',
    file: 'src/app/api/checkout/route.ts',
    pattern: /if \(!CHECKOUT_ALLOW_LIST\.has\(productId\)\)/,
    found: false,
  },
  {
    name: 'Checkout returns 503 for non-allowed products',
    file: 'src/app/api/checkout/route.ts',
    pattern: /status: 503/,
    found: false,
  },
  {
    name: 'Checkout tries LAUNCH50 coupon (Recommendation #3)',
    file: 'src/app/api/checkout/route.ts',
    pattern: /stripe\.coupons\.retrieve\('LAUNCH50'\)/,
    found: false,
  },
  {
    name: 'Checkout passes productId in metadata',
    file: 'src/app/api/checkout/route.ts',
    pattern: /metadata: \{\s*productId,[\s\S]*?productName,[\s\S]*?source/,
    found: false,
  },
  {
    name: 'Checkout GET returns available flag',
    file: 'src/app/api/checkout/route.ts',
    pattern: /available: CHECKOUT_ALLOW_LIST\.has\(id\)/,
    found: false,
  },

  // Download endpoint
  {
    name: '/api/download validates token',
    file: 'src/app/api/download/route.ts',
    pattern: /validateDownloadToken\(token\)/,
    found: false,
  },
  {
    name: '/api/download returns 403 on invalid token',
    file: 'src/app/api/download/route.ts',
    pattern: /status: 403/,
    found: false,
  },
  {
    name: '/api/download falls back to /public when Blob not configured',
    file: 'src/app/api/download/route.ts',
    pattern: /DEV FALLBACK/,
    found: false,
  },

  // Download-link endpoint (for /success page)
  {
    name: '/api/download-link returns URL by session_id',
    file: 'src/app/api/download-link/route.ts',
    pattern: /session_id required/,
    found: false,
  },
  {
    name: '/api/download-link returns retry:true when webhook not fired',
    file: 'src/app/api/download-link/route.ts',
    pattern: /ok: false, retry: true/,
    found: false,
  },

  // Success page
  {
    name: '/success page polls for download link',
    file: 'src/app/success/page.tsx',
    pattern: /fetchDownloadLink/,
    found: false,
  },
  {
    name: '/success page shows Download Now button',
    file: 'src/app/success/page.tsx',
    pattern: /Download Now/,
    found: false,
  },
  {
    name: '/success page shows email reminder',
    file: 'src/app/success/page.tsx',
    pattern: /emailed your download link/,
    found: false,
  },

  // Admin reissue endpoint
  {
    name: '/api/admin/reissue/[email] exists',
    file: 'src/app/api/admin/reissue/[email]/route.ts',
    pattern: /export async function POST/,
    found: false,
  },
  {
    name: 'Admin reissue requires owner auth',
    file: 'src/app/api/admin/reissue/[email]/route.ts',
    pattern: /getServerSession/,
    found: false,
  },
  {
    name: 'Admin reissue verifies operator (first user)',
    file: 'src/app/api/admin/reissue/[email]/route.ts',
    pattern: /orderBy: \{ createdAt: 'asc' \}/,
    found: false,
  },
  {
    name: 'Admin reissue skips revoked tokens',
    file: 'src/app/api/admin/reissue/[email]/route.ts',
    pattern: /if \(tokenData\.revoked\) continue/,
    found: false,
  },
  {
    name: 'Admin reissue logs to audit trail',
    file: 'src/app/api/admin/reissue/[email]/route.ts',
    pattern: /logApprovalEvent/,
    found: false,
  },

  // Buy page updated
  {
    name: 'Buy page shows Buy Now for available products',
    file: 'src/app/buy/[productId]/page.tsx',
    pattern: /product\.available \?/,
    found: false,
  },
  {
    name: 'Buy page shows launch pricing banner',
    file: 'src/app/buy/[productId]/page.tsx',
    pattern: /Launch special.*30% off/,
    found: false,
  },

  // Middleware whitelist
  {
    name: 'Middleware whitelists /download, /download-link, /admin/reissue',
    file: 'src/middleware.ts',
    pattern: /download\|download-link\|admin\/reissue/,
    found: false,
  },
]

for (const c of checks) {
  const abs = path.join(baseDir, c.file)
  try {
    const content = fs.readFileSync(abs, 'utf8')
    c.found = c.pattern.test(content)
  } catch {
    c.found = false
  }
}

console.log('═══════════════════════════════════════════════════════════════')
console.log('  UPGRADE #150 Audit — Product Fulfillment MVP')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')

let allPassed = true
let passed = 0, failed = 0
for (const c of checks) {
  const status = c.found ? '✅' : '❌'
  console.log(`  ${status} ${c.name}`)
  if (c.found) passed++; else { failed++; allPassed = false }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'} (${passed}/${checks.length} passed)`)
console.log('═══════════════════════════════════════════════════════════════')

const report = {
  auditId: 'upgrade-150-verification',
  generatedAt: new Date().toISOString(),
  allPassed,
  totalChecks: checks.length,
  passed,
  failed,
  checks,
}
fs.writeFileSync('/home/z/my-project/download/agent007-upgrade-150-audit.json', JSON.stringify(report, null, 2))
console.log(`\nReport saved: /home/z/my-project/download/agent007-upgrade-150-audit.json`)
