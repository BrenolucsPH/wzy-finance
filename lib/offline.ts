import type { Entry } from "./finance";
import type { Person } from "../app/components";
export type OfflineSnapshot = {
  user: Person;
  entries: Entry[];
  pending: Entry[];
  changes?: {
    id: string;
    operation: "update" | "delete";
    entry: Entry;
    baseVersion: number;
  }[];
  savedAt: number;
};
type Vault = {
  id: string;
  salt: number[];
  iv: number[];
  cipher: ArrayBuffer;
};
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("wzy-private-vault", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("vaults", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("Armazenamento local indisponível."));
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("vaults", mode),
        request = action(tx.objectStore("vaults"));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () =>
        reject(Error("Não foi possível acessar a cópia local."));
      tx.onabort = () => reject(Error("A cópia local não foi salva."));
    });
  } finally {
    db.close();
  }
}
export async function vaultIds() {
  return (await operation("readonly", (s) => s.getAllKeys())).map(String);
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (password.length < 12)
    throw Error("Use uma senha local com pelo menos 12 caracteres.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function saveVault(snapshot: OfflineSnapshot, password: string) {
  const old = await operation<Vault | undefined>("readonly", (s) =>
      s.get(snapshot.user.id),
    ),
    salt = old
      ? new Uint8Array(old.salt)
      : crypto.getRandomValues(new Uint8Array(16)),
    key = await derive(password, salt),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    cipher = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(snapshot.user.id),
      },
      key,
      new TextEncoder().encode(JSON.stringify(snapshot)),
    );
  await operation("readwrite", (s) =>
    s.put({ id: snapshot.user.id, salt: [...salt], iv: [...iv], cipher }),
  );
}
export async function unlockVault(
  id: string,
  password: string,
): Promise<OfflineSnapshot> {
  const vault = await operation<Vault | undefined>("readonly", (s) =>
    s.get(id),
  );
  if (!vault) throw Error("Cópia local não encontrada.");
  try {
    const key = await derive(password, new Uint8Array(vault.salt)),
      clear = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(vault.iv),
          additionalData: new TextEncoder().encode(id),
        },
        key,
        vault.cipher,
      );
    const snapshot = JSON.parse(
      new TextDecoder().decode(clear),
    ) as OfflineSnapshot;
    if (snapshot.user.id !== id) throw Error();
    return snapshot;
  } catch {
    throw Error("Senha local incorreta ou cópia inválida.");
  }
}
export async function removeVault(id: string) {
  await operation("readwrite", (s) => s.delete(id));
}
