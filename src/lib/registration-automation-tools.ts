/**
 * registration-automation-tools.ts — 5 tools for account creation,
 * domain registration, payment processing, email automation, and
 * user data management.
 *
 * All 5 are auto-locked (NEVER_REMOVABLE) + auto-FULL_ACCESS.
 */

import { ToolResult, ToolContext, okResult, badResult } from './tools'
import { db } from './db'
import { sendEmail } from './email'

/* 1. API Integration Tool — interact with external APIs for account/domain registration */
export async function toolApiIntegration(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const service = (args?.service ?? 'unknown').toString()
  const action = (args?.action ?? 'register').toString()
  const payload = args?.payload ?? {}

  return okResult(
    `API integration: ${action} on ${service} — plan generated`,
    `API INTEGRATION TOOL — ${service.toUpperCase()}\n${'='.repeat(60)}\n\n` +
    `Service: ${service}\nAction: ${action}\nPayload: ${JSON.stringify(payload, null, 2)}\n\n` +
    `REGISTRATION PLAN:\n` +
    `  1. Identify API endpoint for ${service} ${action}\n` +
    `  2. Check auth requirements (API key, OAuth, bearer token)\n` +
    `  3. Prepare request payload with required fields\n` +
    `  4. Send POST/PUT request via http_fetch or code_exec\n` +
    `  5. Parse response — extract account ID / domain confirmation\n` +
    `  6. Store credentials in API key vault\n` +
    `  7. Log to audit trail\n\n` +
    `SUPPORTED SERVICES:\n` +
    `  • Domain registration: Namecheap API, GoDaddy API, Cloudflare API, Google Domains\n` +
    `  • Account creation: Stripe, PayPal, AWS, Google Cloud, Vercel, GitHub\n` +
    `  • Social platforms: Twitter API, LinkedIn API, Facebook Business API\n` +
    `  • Email providers: SendGrid, Mailgun, Postmark, ConvertKit\n` +
    `  • E-commerce: Shopify, Etsy, Amazon Seller, Printify, Printful\n\n` +
    `EXECUTION: Use http_fetch to call the API, or use code_exec for complex flows.\n` +
    `Example: <tool name="http_fetch">{"url":"https://api.namecheap.com/xml.response?ApiUser=...&Command=namecheap.domains.create"}</tool>\n` +
    `Example: <tool name="code_exec">{"code":"const res = await fetch('https://api.stripe.com/v1/accounts', {method:'POST',headers:{'Authorization':'Bearer '+key},body:JSON.stringify(payload)})"}</tool>`
  )
}

/* 2. Payment Processing Tool — handle payments during registration */
export async function toolPaymentProcessing(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const amount = parseFloat(args?.amount ?? '0')
  const currency = (args?.currency ?? 'USD').toString()
  const method = (args?.method ?? 'stripe').toString()
  const description = (args?.description ?? 'Registration payment').toString()

  return okResult(
    `Payment: $${amount} ${currency} via ${method} — plan generated`,
    `PAYMENT PROCESSING TOOL\n${'='.repeat(60)}\n\n` +
    `Amount: $${amount} ${currency}\nMethod: ${method}\nDescription: ${description}\n\n` +
    `SUPPORTED PAYMENT METHODS:\n` +
    `  1. Stripe — credit cards, subscriptions, one-time payments\n` +
    `     POST https://api.stripe.com/v1/payment_intents\n` +
    `     Auth: Bearer sk_live_...\n` +
    `  2. PayPal — PayPal balance, cards, Pay Later\n` +
    `     POST https://api.paypal.com/v2/checkout/orders\n` +
    `     Auth: Bearer access_token\n` +
    `  3. Wise — international bank transfers\n` +
    `     POST https://api.wise.com/transfers\n` +
    `  4. Coinbase Commerce — crypto (BTC, ETH, USDC)\n` +
    `     POST https://api.commerce.coinbase.com/charges\n` +
    `  5. Square — card present + card not present\n` +
    `     POST https://connect.squareup.com/v2/payments\n\n` +
    `REGISTRATION PAYMENT FLOW:\n` +
    `  1. Create payment intent (Stripe) or order (PayPal)\n` +
    `  2. Collect payment method from user\n` +
    `  3. Confirm payment\n` +
    `  4. Webhook receives confirmation → activate account\n` +
    `  5. Log to IncomeEntry table\n\n` +
    `EXECUTION: Use code_exec to call the payment API, then verify via webhook.`
  )
}

/* 3. Email Automation Tool — send verification emails + notifications */
export async function toolEmailAutomation(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const to = (args?.to ?? '').toString()
  const subject = (args?.subject ?? 'Verification Required').toString()
  const template = (args?.template ?? 'verification').toString()
  const data = args?.data ?? {}

  if (!to) return badResult('email_automation requires "to" email address')

  // Build email body based on template
  let body = ''
  switch (template) {
    case 'verification':
      body = `Hello,\n\nPlease verify your email address by clicking the link below:\n\n${data.verificationUrl || '[VERIFICATION LINK]'}\n\nThis link expires in 24 hours.\n\n— Agent007 AI`
      break
    case 'welcome':
      body = `Welcome to Agent007 AI!\n\nYour account has been created successfully.\n\nAccount details:\n  Email: ${to}\n  Plan: ${data.plan || 'Free'}\n\nGet started: ${data.dashboardUrl || 'https://agent007-ai.vercel.app'}\n\n— Agent007 AI`
      break
    case 'password_reset':
      body = `Password reset requested.\n\nReset link: ${data.resetUrl || '[RESET LINK]'}\n\nIf you didn't request this, ignore this email.\n\n— Agent007 AI`
      break
    case 'notification':
      body = `${data.message || 'You have a new notification.'}\n\n— Agent007 AI`
      break
    default:
      body = `${data.message || data.body || 'No content specified.'}\n\n— Agent007 AI`
  }

  // Actually send the email via Resend
  try {
    const result = await sendEmail({
      to,
      subject,
      body,
      type: template,
    })

    // Log to NotificationLog
    try {
      const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
      if (userId) {
        await db.notificationLog.create({
          data: { userId, type: template, to, subject, body, sent: result.sent }
        })
      }
    } catch {}

    return okResult(
      `Email sent to ${to}: ${subject} (${result.sent ? 'delivered' : 'logged'})`,
      `EMAIL AUTOMATION\n${'='.repeat(60)}\nTo: ${to}\nSubject: ${subject}\nTemplate: ${template}\nSent: ${result.sent ? '✅ Yes' : '⚠ Logged only'}\n${result.error ? `Error: ${result.error}` : ''}\n\nBody:\n${body}`
    )
  } catch (e: any) {
    return badResult(`email_automation failed: ${e?.message}`)
  }
}

/* 4. UI Form Builder — create forms to collect user information */
export async function toolUiFormBuilder(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const formName = (args?.name ?? 'registration_form').toString()
  const fields = args?.fields ?? [
    { name: 'email', type: 'email', label: 'Email Address', required: true },
    { name: 'password', type: 'password', label: 'Password', required: true },
    { name: 'name', type: 'text', label: 'Full Name', required: true },
  ]
  const submitUrl = (args?.submit_url ?? '/api/auth/register').toString()

  // Generate HTML form
  const htmlForm = `<!DOCTYPE html>
<html>
<head><title>${formName}</title></head>
<body>
<form action="${submitUrl}" method="POST" id="agent007-form">
${fields.map((f: any) => `  <label>${f.label || f.name}${f.required ? ' *' : ''}</label>
  <input type="${f.type || 'text'}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="${f.placeholder || f.label || f.name}" /><br/>`).join('\n')}
  <button type="submit">Submit</button>
</form>
</body>
</html>`

  // Generate React/Next.js component
  const reactComponent = `export function ${formName.charAt(0).toUpperCase() + formName.slice(1)}() {
  return (
    <form action="${submitUrl}" method="POST">
${fields.map((f: any) => `      <div>
        <label>${f.label || f.name}${f.required ? ' *' : ''}</label>
        <input type="${f.type || 'text'}" name="${f.name}" ${f.required ? 'required' : ''} />
      </div>`).join('\n')}
      <button type="submit">Submit</button>
    </form>
  )
}`

  return okResult(
    `Form "${formName}" generated: ${fields.length} fields`,
    `UI FORM BUILDER — ${formName}\n${'='.repeat(60)}\n\n` +
    `FIELDS (${fields.length}):\n${fields.map((f: any) => `  • ${f.name} (${f.type || 'text'})${f.required ? ' [required]' : ''}`).join('\n')}\n\n` +
    `SUBMIT URL: ${submitUrl}\n\n` +
    `HTML FORM:\n${htmlForm}\n\n` +
    `REACT COMPONENT:\n${reactComponent}\n\n` +
    `SUPPORTED FIELD TYPES:\n` +
    `  text, email, password, tel, url, number, date, select, textarea, checkbox, radio, file\n\n` +
    `USAGE: Dispatch FORGE to integrate this form into the Next.js app.`
  )
}

/* 5. Database Manager — store user data + account details securely */
export async function toolDatabaseManager(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args?.action ?? 'create').toString()
  const table = (args?.table ?? 'User').toString()
  const data = args?.data ?? {}

  try {
    switch (action) {
      case 'create': {
        // Store data in the specified table
        const modelName = table.charAt(0).toLowerCase() + table.slice(1)
        const model = (db as any)[modelName]
        if (!model) {
          return badResult(`Database table "${table}" not found. Available: User, UserSetting, IncomeEntry, Customer, ApiKey, AuditLog, etc.`)
        }
        const record = await model.create({ data })
        return okResult(
          `Created ${table} record: ${record.id ?? 'success'}`,
          `DATABASE CREATE — ${table}\n${'='.repeat(60)}\nRecord ID: ${record.id}\nData: ${JSON.stringify(record, null, 2).slice(0, 500)}`
        )
      }
      case 'read': {
        const modelName = table.charAt(0).toLowerCase() + table.slice(1)
        const model = (db as any)[modelName]
        if (!model) return badResult(`Table "${table}" not found`)
        const records = await model.findMany({ take: args?.limit ?? 10, where: args?.where ?? {} })
        return okResult(
          `Read ${records.length} records from ${table}`,
          `DATABASE READ — ${table}\n${'='.repeat(60)}\n${records.length} records:\n${JSON.stringify(records, null, 2).slice(0, 1000)}`
        )
      }
      case 'update': {
        const modelName = table.charAt(0).toLowerCase() + table.slice(1)
        const model = (db as any)[modelName]
        if (!model) return badResult(`Table "${table}" not found`)
        const record = await model.update({ where: args?.where, data })
        return okResult(
          `Updated ${table} record`,
          `DATABASE UPDATE — ${table}\n${'='.repeat(60)}\nUpdated: ${JSON.stringify(record, null, 2).slice(0, 500)}`
        )
      }
      case 'delete': {
        const modelName = table.charAt(0).toLowerCase() + table.slice(1)
        const model = (db as any)[modelName]
        if (!model) return badResult(`Table "${table}" not found`)
        await model.delete({ where: args?.where })
        return okResult(
          `Deleted ${table} record`,
          `DATABASE DELETE — ${table}\nRecord deleted successfully.`
        )
      }
      case 'list_tables': {
        const tables = Object.keys(db).filter(k => !k.startsWith('_') && !k.startsWith('$') && typeof (db as any)[k]?.count === 'function')
        return okResult(
          `${tables.length} tables available`,
          `DATABASE TABLES (${tables.length}):\n${tables.map(t => `  • ${t}`).join('\n')}`
        )
      }
      default:
        return badResult(`Unknown action: ${action}. Use: create, read, update, delete, list_tables`)
    }
  } catch (e: any) {
    return badResult(`database_manager failed: ${e?.message}`)
  }
}
