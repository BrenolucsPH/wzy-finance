"use client";
import type { Attachment } from "../app/components";
async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch("/api/uploads" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error || "Não foi possível enviar o arquivo.");
  return result;
}
export async function uploadAttachment(file: File): Promise<Attachment> {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Selecione um PDF, JPG ou PNG de até 10 MB.");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const type =
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
      ? "application/pdf"
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "image/jpeg"
        : bytes[0] === 137 &&
            bytes[1] === 80 &&
            bytes[2] === 78 &&
            bytes[3] === 71
          ? "image/png"
          : null;
  if (!type) throw new Error("Formato não permitido. Use PDF, JPG ou PNG.");
  const reservation = await request<{
    id: string;
    pathname: string;
    token: string;
  }>("", { name: file.name, size: file.size, type });
  try {
    const { put } = await import("@vercel/blob/client");
    await put(reservation.pathname, file, {
      access: "private",
      token: reservation.token,
      contentType: type,
    });
    return (
      await request<{
        file: Attachment;
      }>("/finish", { id: reservation.id })
    ).file;
  } catch (error) {
    await request("/cancel", { id: reservation.id }).catch(() => undefined);
    throw error;
  }
}
