export type PasswordExposureResult = {
  compromised: boolean;
  occurrences: number;
};

/**
 * Checks a candidate password against HIBP Pwned Passwords using k-anonymity.
 * The password and full SHA-1 digest remain in the browser; only the first
 * five hexadecimal characters of the digest are sent to the public range API.
 */
export async function checkPasswordExposure(password: string): Promise<PasswordExposureResult> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Este navegador não oferece verificação criptográfica segura.");
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(password),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("").toUpperCase();

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    method: "GET",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    throw new Error("O serviço de verificação de senhas está indisponível.");
  }

  const entries = (await response.text()).split(/\r?\n/);
  const match = entries.find((entry) =>
    entry.slice(0, entry.indexOf(":")).trim().toUpperCase() === suffix,
  );
  const occurrences = match ? Number(match.slice(match.indexOf(":") + 1).trim()) || 0 : 0;

  return { compromised: occurrences > 0, occurrences };
}
