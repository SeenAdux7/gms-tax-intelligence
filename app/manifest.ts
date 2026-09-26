import type { MetadataRoute } from 'next'

/**
 * Web app manifest — what makes this installable
 * ==============================================
 *
 * The brief's answer to "mobile app and website" is one codebase: this file is
 * the difference between a website and something that sits on a phone's home
 * screen with its own icon and no browser chrome.
 *
 * `display: 'standalone'` is the load-bearing line. Without it the app opens in
 * a browser tab with an address bar, which is exactly the thing that makes a
 * web app feel like a website.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mobility Tax Intelligence',
    // Home screens truncate at roughly 12 characters, so the short name is
    // chosen to survive that rather than being an abbreviation of the long one.
    short_name: 'Mobility Tax',
    description:
      'Track tax, payroll, social security and treaty developments affecting mobile employees — ' +
      'explained in plain language, with sources. Educational use only.',
    start_url: '/updates',
    // Opens on the feed, not '/'. '/' only redirects there, and an installed app
    // that begins with a redirect shows a blank flash on every launch.
    id: '/updates',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1d4ed8',
    categories: ['education', 'finance', 'productivity'],
    lang: 'en',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops icons to the launcher's shape. The maskable copies carry
      // 20% padding so a circular or squircle crop eats the padding rather than
      // the mark.
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    // Long-press the installed icon to jump straight in. Cheap to declare and
    // it is the kind of detail that makes an installed web app feel native.
    shortcuts: [
      { name: 'Updates', short_name: 'Updates', url: '/updates' },
      { name: 'Lessons', short_name: 'Learn', url: '/learn' },
      { name: 'Vocabulary', short_name: 'Words', url: '/vocabulary' },
    ],
  }
}
