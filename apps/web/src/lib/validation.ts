// Shared field validators for forms (booking, clients, employees).

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// North American mobile/phone: 10 digits, or 11 starting with country code 1.
// Accepts common formatting characters (spaces, dashes, parens, +).
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}
