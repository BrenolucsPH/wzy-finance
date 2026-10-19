export async function sealBackup(value: unknown) {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw) throw Error("ENCRYPTION_UNAVAILABLE");
  const material = await crypto.subtle.importKey(
    "raw",
    Buffer.from(raw, "base64"),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("wzy-backups-v1"),
      info: new TextEncoder().encode("financial-snapshot"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    );
  return JSON.stringify({
    version: 1,
    iv: Buffer.from(iv).toString("base64"),
    cipher: Buffer.from(cipher).toString("base64"),
  });
}
export async function openBackup(payload: string) {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw) throw Error("ENCRYPTION_UNAVAILABLE");
  const value = JSON.parse(payload);
  const material = await crypto.subtle.importKey(
    "raw",
    Buffer.from(raw, "base64"),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("wzy-backups-v1"),
      info: new TextEncoder().encode("financial-snapshot"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(Buffer.from(value.iv, "base64")) },
    key,
    Buffer.from(value.cipher, "base64"),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}
