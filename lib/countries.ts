// A flag for a restaurant's country (country_code, like "JP"), or "" for
// the US and unknown countries. Wotri's users are in the US, so a flag only
// marks places abroad.
export function countryFlag(code: string | null | undefined) {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === 'US') {
    return '';
  }

  // Each letter becomes its regional indicator symbol; a pair is a flag.
  return String.fromCodePoint(
    ...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
  );
}

// "🇯🇵 McDonald's" abroad, "McDonald's" at home.
export function withFlag(name: string, code: string | null | undefined) {
  const flag = countryFlag(code);
  return flag ? `${flag} ${name}` : name;
}
