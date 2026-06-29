// Generate PWA icons from the Agent007 hex logo
const sharp = require('sharp')
const path = require('path')

const SVG = `<svg width="512" height="512" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="64" height="64" fill="#000000"/>
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="none" stroke="url(#g)" stroke-width="2.5" filter="url(#glow)" stroke-linejoin="round"/>
  <polygon points="32,12 49,22 49,42 32,52 15,42 15,22" fill="rgba(0,240,255,0.06)" stroke="rgba(0,240,255,0.3)" stroke-width="1"/>
  <path d="M22 44 L32 22 L42 44 M26 36 L38 36" fill="none" stroke="#00f0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <circle cx="32" cy="32" r="2" fill="#ec4899" filter="url(#glow)"/>
</svg>`

async function main() {
  // 192x192 standard icon
  await sharp(Buffer.from(SVG))
    .resize(192, 192)
    .png()
    .toFile(path.join(__dirname, '..', 'public', 'icon-192.png'))
  console.log('✓ icon-192.png')

  // 512x512 standard icon
  await sharp(Buffer.from(SVG))
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, '..', 'public', 'icon-512.png'))
  console.log('✓ icon-512.png')

  // 512x512 maskable icon (with padding for safe area)
  const maskableSvg = `<svg width="512" height="512" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" fill="#000000"/>
    <g transform="translate(8,8) scale(0.75)">
      <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="none" stroke="#00f0ff" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M22 44 L32 22 L42 44 M26 36 L38 36" fill="none" stroke="#00f0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, '..', 'public', 'icon-maskable-512.png'))
  console.log('✓ icon-maskable-512.png')

  // favicon.ico (32x32)
  await sharp(Buffer.from(SVG))
    .resize(32, 32)
    .png()
    .toFile(path.join(__dirname, '..', 'public', 'favicon-32.png'))
  console.log('✓ favicon-32.png')
}

main().catch(console.error)
