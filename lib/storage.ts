import { put, get, del } from "@vercel/blob";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
function localFile(pathname: string) {
  if (
    process.env.WZY_LOCAL_QA !== "1" ||
    !/^wzy_qa_[a-f0-9]{32}$/.test(process.env.WZY_TEST_SCHEMA || "") ||
    !process.env.WZY_QA_STORAGE_DIRECTORY
  )
    return null;
  const root = resolve(process.env.WZY_QA_STORAGE_DIRECTORY),
    file = resolve(root, pathname);
  if (
    !file.startsWith(root + sep) ||
    pathname.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw Error("INVALID_QA_FILE_PATH");
  return file;
}
export const bucket = {
  async put(
    pathname: string,
    bytes: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ) {
    const file = localFile(pathname);
    if (file) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
      return { pathname };
    }
    return put(pathname, Buffer.from(bytes), {
      access: "private",
      contentType: options.httpMetadata.contentType,
      addRandomSuffix: false,
    });
  },
  async get(pathname: string) {
    const file = localFile(pathname);
    if (file) {
      try {
        return { body: new Blob([await readFile(file)]).stream() };
      } catch {
        return null;
      }
    }
    const result = await get(pathname, { access: "private", useCache: false });
    return result?.statusCode === 200 ? { body: result.stream } : null;
  },
  async delete(pathname: string) {
    const file = localFile(pathname);
    if (file) {
      await unlink(file).catch(() => {});
      return;
    }
    await del(pathname);
  },
};
