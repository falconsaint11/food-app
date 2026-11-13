import * as WebBrowser from 'expo-web-browser';

// Pages on wotri.app (the website/ folder, hosted on Cloudflare Pages).
export const LEGAL_URLS = {
  terms: 'https://wotri.app/terms',
  privacy: 'https://wotri.app/privacy',
  support: 'https://wotri.app/support',
} as const;

// Opens a wotri.app page in an in-app browser sheet.
export function openLegalPage(page: keyof typeof LEGAL_URLS) {
  WebBrowser.openBrowserAsync(LEGAL_URLS[page]).catch((error) =>
    console.log('Open page error:', error)
  );
}
