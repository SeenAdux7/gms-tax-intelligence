/**
 * Generates the PWA icon set from one SVG
 * =======================================
 *
 * An installable app needs real PNGs at fixed sizes — Android will not offer
 * the install prompt without 192px and 512px, and iOS ignores the manifest and
 * wants its own apple-touch-icon. Hand-exporting five files from a drawing tool
 * is the kind of step that rots, so the source of truth is the SVG below and
 * the PNGs are generated.
 *
 * The maskable variant has ~20% padding on every side. Android crops icons to
 * whatever shape the launcher uses (circle, squircle, rounded square), and an
 * icon drawn to the edges gets its corners eaten. The padded copy is declared
 * `purpose: "maskable"` so the launcher crops the padding instead of the mark.
 *
 * Run with:  npm run icons
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const OUT = 'public/icons'

/**
 * The mark: a document with a highlighted line and a checkmark.
 *
 * It says "a source, quoted, and verified" — which is what the product does —
 * and it reads at 48px, which most detailed logos do not. Drawn on the app's
 * accent blue so the installed icon matches the app's own chrome.
 */
function svg(size: number, padding: number): string {
  const inner = size - padding * 2
  const s = (n: number) => (n * inner) / 100 + padding

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#1d4ed8"/>
  <g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="${inner * 0.07}">
    <path d="M ${s(26)} ${s(18)} h ${inner * 0.36} l ${inner * 0.12} ${inner * 0.12} v ${inner * 0.52} a ${inner * 0.04} ${inner * 0.04} 0 0 1 ${-inner * 0.04} ${inner * 0.04} h ${-inner * 0.44} a ${inner * 0.04} ${inner * 0.04} 0 0 1 ${-inner * 0.04} ${-inner * 0.04} v ${-inner * 0.6} a ${inner * 0.04} ${inner * 0.04} 0 0 1 ${inner * 0.04} ${-inner * 0.04} z"/>
    <path d="M ${s(36)} ${s(40)} h ${inner * 0.2}"/>
    <path d="M ${s(36)} ${s(52)} h ${inner * 0.28}"/>
  </g>
  <g fill="none" stroke="#7ba2ff" stroke-linecap="round" stroke-linejoin="round" stroke-width="${inner * 0.09}">
    <path d="M ${s(38)} ${s(70)} l ${inner * 0.09} ${inner * 0.09} l ${inner * 0.19} ${-inner * 0.22}"/>
  </g>
</svg>`
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  { file: 'icon-maskable-192.png', size: 192, padding: 192 * 0.2 },
  { file: 'icon-maskable-512.png', size: 512, padding: 512 * 0.2 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0 },
]

async function main() {
  mkdirSync(OUT, { recursive: true })

  for (const target of TARGETS) {
    const buffer = await sharp(Buffer.from(svg(target.size, target.padding)))
      .png({ compressionLevel: 9 })
      .toBuffer()
    writeFileSync(`${OUT}/${target.file}`, buffer)
    console.log(`  ${OUT}/${target.file}  ${target.size}x${target.size}  ${Math.round(buffer.length / 1024)}KB`)
  }

  // Keep the SVG too: it is the source, and browsers that accept it get a
  // sharp icon at any size.
  writeFileSync(`${OUT}/icon.svg`, svg(512, 0))
  console.log(`  ${OUT}/icon.svg`)
  console.log('\nDone.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
