// Invite codes are bearer tokens: the "CET6" prefix plus 12 characters from a
// 32-symbol unambiguous alphabet (~60 bits of entropy), far beyond guessing at
// the Access-verified request rate. Codes are stored and compared in canonical
// form (upper-case alphanumerics only) so users may type them with or without
// separators.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateInviteCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let code = 'CET6';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}
export function canonicalInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function formatInviteCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}
export function isPlausibleInviteCode(code: string): boolean {
  return /^[A-Z0-9]{8,24}$/.test(code);
}
