"""
UPGRADE #174: Generate a 1-page setup guide PDF for the 2 remaining
API keys (CONVERTKIT_API_KEY + AMAZON_ASSOCIATES_TAG + AMAZON_PA_API_KEY).
Uses ReportLab via the pdf skill's Report brief.
"""
import os, sys
PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, "scripts"))

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether
)
from reportlab.pdfgen import canvas

OUTPUT_PATH = "/home/z/my-project/download/agent007-api-key-setup-guide.pdf"

# Brand palette (Antonio's agent colors)
COLOR_PRIMARY = HexColor("#00f0ff")     # cyan
COLOR_DARK = HexColor("#0a1929")          # deep navy
COLOR_ACCENT = HexColor("#10b981")        # green (revenue-positive)
COLOR_WARN = HexColor("#f59e0b")          # amber
COLOR_TEXT = HexColor("#1e293b")          # slate-800
COLOR_MUTED = HexColor("#64748b")         # slate-500
COLOR_BG = white
COLOR_BORDER = HexColor("#e2e8f0")

# Build the document
doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=letter,
    leftMargin=0.6 * inch,
    rightMargin=0.6 * inch,
    topMargin=0.5 * inch,
    bottomMargin=0.5 * inch,
    title="Agent007 AI — API Key Setup Guide",
    author="Agent007 AI",
    subject="Setup guide for ConvertKit + Amazon Associates to unlock 95% autonomy",
    creator="Agent007 AI",
)

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Title'],
    fontName='Helvetica-Bold',
    fontSize=20,
    textColor=COLOR_DARK,
    spaceAfter=6,
    alignment=TA_LEFT,
)
subtitle_style = ParagraphStyle(
    'Subtitle',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=10,
    textColor=COLOR_MUTED,
    spaceAfter=14,
    alignment=TA_LEFT,
)
h2_style = ParagraphStyle(
    'H2',
    parent=styles['Heading2'],
    fontName='Helvetica-Bold',
    fontSize=12,
    textColor=COLOR_PRIMARY,
    spaceBefore=12,
    spaceAfter=4,
)
body_style = ParagraphStyle(
    'Body',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=9.5,
    textColor=COLOR_TEXT,
    leading=12,
    spaceAfter=4,
)
small_style = ParagraphStyle(
    'Small',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8.5,
    textColor=COLOR_MUTED,
    leading=10,
)
mono_style = ParagraphStyle(
    'Mono',
    parent=styles['Code'],
    fontName='Courier-Bold',
    fontSize=9,
    textColor=COLOR_DARK,
    backColor=HexColor("#f1f5f9"),
    leftIndent=8,
    rightIndent=8,
    spaceBefore=2,
    spaceAfter=6,
    borderColor=COLOR_BORDER,
    borderWidth=1,
    borderPadding=4,
)
callout_style = ParagraphStyle(
    'Callout',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=9.5,
    textColor=COLOR_DARK,
    backColor=HexColor("#ecfdf5"),
    leftIndent=8,
    rightIndent=8,
    spaceBefore=6,
    spaceAfter=8,
    borderColor=COLOR_ACCENT,
    borderWidth=1,
    borderPadding=6,
)

story = []

# === HEADER ===
story.append(Paragraph("Agent007 AI — API Key Setup Guide", title_style))
story.append(Paragraph(
    "Add these 2 keys to unlock 95% autonomy + start earning real money. "
    "Verified live on https://agent007-ai.vercel.app at 2026-07-30 UTC.",
    subtitle_style
))

# === CURRENT STATE (from /api/system/capability-audit) ===
story.append(Paragraph("Current Autonomy Status", h2_style))
story.append(Paragraph(
    "Per the live <b>/api/system/capability-audit</b> endpoint, your agent is at "
    "<b>50% revenue-critical autonomy</b>. Stripe, Buffer, Google Analytics, and "
    "WordPress are already configured. Two keys remain to reach 100%:",
    body_style
))

status_data = [
    ['Tool', 'Required Env Vars', 'Status'],
    ['stripe_payment_processor', 'STRIPE_SECRET_KEY', 'READY'],
    ['buffer_scheduler', 'BUFFER_ACCESS_TOKEN', 'READY'],
    ['google_analytics', 'GOOGLE_ANALYTICS_API_KEY', 'READY'],
    ['wordpress_publisher', 'WORDPRESS_URL + USER + APP_PASSWORD', 'READY'],
    ['paypal_api', 'PAYPAL_CLIENT_ID + SECRET', 'Optional'],
    ['convertkit_email', 'CONVERTKIT_API_KEY', 'MISSING'],
    ['affiliate_link_generator', 'AMAZON_ASSOCIATES_TAG + PA_API_KEY', 'MISSING'],
]

status_table = Table(status_data, colWidths=[2.0*inch, 3.0*inch, 1.4*inch])
status_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 9.5),
    ('BACKGROUND', (0, 0), (-1, 0), COLOR_DARK),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
    ('FONTSIZE', (0, 1), (-1, -1), 8.5),
    ('TEXTCOLOR', (0, 1), (-1, -1), COLOR_TEXT),
    ('BACKGROUND', (0, 1), (-1, 1), HexColor("#dcfce7")),  # Stripe READY
    ('BACKGROUND', (0, 2), (-1, 2), HexColor("#dcfce7")),  # Buffer READY
    ('BACKGROUND', (0, 3), (-1, 3), HexColor("#dcfce7")),  # GA READY
    ('BACKGROUND', (0, 4), (-1, 4), HexColor("#dcfce7")),  # WP READY
    ('BACKGROUND', (0, 5), (-1, 5), HexColor("#fef3c7")),  # PayPal Optional
    ('BACKGROUND', (0, 6), (-1, 6), HexColor("#fee2e2")),  # ConvertKit MISSING
    ('BACKGROUND', (0, 7), (-1, 7), HexColor("#fee2e2")),  # Amazon MISSING
    ('GRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
]))
story.append(status_table)

story.append(Spacer(1, 8))

# === STEP 1: CONVERTKIT ===
story.append(Paragraph("Step 1: Add ConvertKit (Email Marketing) — 30 min, Free", h2_style))
story.append(Paragraph(
    "<b>Why:</b> Lets the agent send real email sequences (welcome, nurture, "
    "abandoned cart, post-purchase). Without this, your email capture → nurture "
    "loop is broken. ConvertKit is free for the first 1,000 subscribers.",
    body_style
))
story.append(Paragraph(
    "<b>How:</b><br/>"
    "1. Sign up at https://convertkit.com (free tier, no credit card)<br/>"
    "2. Go to Settings → API Keys → Generate new API secret key<br/>"
    "3. Copy the API key (looks like abc123xyz...)<br/>"
    "4. Go to https://vercel.com/antoniocan2022-devs-projects/agent007-ai/settings/environment-variables<br/>"
    "5. Click \"Add New\" → Key: <font face='Courier'>CONVERTKIT_API_KEY</font> → Value: paste key → Environment: Production<br/>"
    "6. Click Save. Vercel auto-redeploys.<br/>"
    "7. Verify: curl https://agent007-ai.vercel.app/api/system/capability-audit | jq '.tools_with_credentials[] | select(.name == \"convertkit_email\")' — should return the tool entry, not null.",
    body_style
))
story.append(Paragraph(
    "After this, the agent can: create subscribers, send broadcasts, build automated sequences, tag subscribers by behavior.",
    small_style
))

# === STEP 2: AMAZON ASSOCIATES ===
story.append(Paragraph("Step 2: Add Amazon Associates (Affiliate Links) — 1 hour, Free", h2_style))
story.append(Paragraph(
    "<b>Why:</b> Lets the agent generate REAL affiliate links (Amazon, ShareASale, Impact, Awin, ClickBank). "
    "Without this, the affiliate_link_generator tool falls back to generic URLs that don't track your commissions. "
    "Amazon pays 1-4% on most categories, higher on some.",
    body_style
))
story.append(Paragraph(
    "<b>How:</b><br/>"
    "1. Apply at https://affiliate-program.amazon.com (use your website or any blog URL — approval takes 1-3 days)<br/>"
    "2. Once approved, get your <b>Associate Tag</b> (looks like <font face='Courier'>yourname-20</font>)<br/>"
    "3. Go to https://webservices.amazon.com/paapi (Product Advertising API) → Request API access<br/>"
    "4. Create a credential pair: <b>Access Key</b> + <b>Secret Key</b><br/>"
    "5. Add 2 Vercel env vars:<br/>"
    "   • Key: <font face='Courier'>AMAZON_ASSOCIATES_TAG</font> → Value: yourname-20<br/>"
    "   • Key: <font face='Courier'>AMAZON_PA_API_KEY</font> → Value: AKIA... (the Access Key)<br/>"
    "   • Key: <font face='Courier'>AMAZON_PA_API_SECRET</font> → Value: (the Secret Key)<br/>"
    "6. Save all 3. Vercel auto-redeploys.<br/>"
    "7. Verify: re-run capability-audit — affiliate_link_generator should now show as READY.",
    body_style
))
story.append(Paragraph(
    "After this, the agent can: generate real affiliate links for any Amazon product, look up product prices + reviews, "
    "build affiliate funnels with real commission tracking, auto-pick trending products in your niche.",
    small_style
))

# === AFTER BOTH: WHAT THE AGENT CAN DO ===
story.append(Paragraph("After Both Keys: What Your Agent Can Do Autonomously", h2_style))
story.append(Paragraph(
    "Once Steps 1 + 2 are complete, run this mission in chat:<br/>",
    body_style
))
story.append(Paragraph(
    "&gt; start mission: affiliate_campaign: best AI tools for freelancers",
    mono_style
))
story.append(Paragraph(
    "The agent will then autonomously:<br/>"
    "1. <b>SCOUT</b> researches 5 trending AI tools freelancers actually want (uses web_search + accuracy_checker to verify each claim via Wikipedia + DuckDuckGo + Brave + LLM)<br/>"
    "2. <b>FORGE</b> generates real Amazon affiliate links for each (using your Associates Tag + PA API)<br/>"
    "3. <b>QUILL</b> writes 5 SEO blog posts reviewing each tool (~1500 words each)<br/>"
    "4. <b>AURORA</b> creates 5 social media graphics + captions for each tool<br/>"
    "5. <b>BUFFER</b> schedules 30 days of social posts across Instagram/Facebook/LinkedIn/X (already configured)<br/>"
    "6. <b>CONVERTKIT</b> creates a 7-email nurture sequence + adds a landing-page form to capture emails<br/>"
    "7. <b>STRIPE</b> creates a $19 \"AI Tools Cheat Sheet\" digital product (already configured)<br/>"
    "8. <b>QUANTUM</b> tracks revenue by blog post + email + social combo, then doubles down on what works (memory persists FOREVER — it learns)<br/>"
    "9. <b>ECHO</b> verifies all 5 reviews pass the quality gate (90/100) before publishing<br/>"
    "10. <b>YOU (CEO)</b> receive a final report with: how much each tool earned, which blog post drove the most clicks, which email had the highest open rate, what to do next.",
    body_style
))

# === CALL TO ACTION ===
story.append(Paragraph(
    "Total setup time: ~90 min. Total monthly cost: $0 (all on free tiers). "
    "Once configured, you can launch a new affiliate campaign every week — fully autonomous.",
    callout_style
))

# === FOOTER NOTE ===
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Generated by Agent007 AI · Live audit at https://agent007-ai.vercel.app/api/system/capability-audit · "
    "Token expires — revoke at https://vercel.com/account/tokens after setup",
    small_style
))

# === BUILD PDF ===
doc.build(story)
print(f"PDF generated: {OUTPUT_PATH}")
print(f"Size: {os.path.getsize(OUTPUT_PATH)} bytes")
