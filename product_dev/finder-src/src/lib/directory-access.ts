export type StoredDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  values(): AsyncIterableIterator<FileSystemFileHandle | StoredDirectoryHandle>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<StoredDirectoryHandle>;
  }
}

const DATABASE = "comart-product-finder";
const STORE = "directory-handles";
const DEFAULT_KEY = "default-products";

export function supportsDirectoryAccess() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function" && "indexedDB" in window;
}

export function safeRelativeParts(relativePath: string) {
  const parts = relativePath.replaceAll("\\", "/").replace(/^products\//i, "").split("/").filter(Boolean);
  if (!parts.length || !["OwnProduct", "Outsourcing"].includes(parts[0]) ||
      parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("不安全或不屬於產品資料庫的相對路徑");
  }
  return parts;
}

export async function pickDefaultDirectory() {
  if (!window.showDirectoryPicker) throw new Error("此瀏覽器不支援固定本機資料夾");
  const handle = await window.showDirectoryPicker({ id: "comart-product-library", mode: "readwrite" });
  await saveDirectoryHandle(handle);
  return handle;
}

export async function loadDirectoryHandle(): Promise<StoredDirectoryHandle | null> {
  if (!supportsDirectoryAccess()) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(STORE, "readonly");
      const get = tx.objectStore(STORE).get(DEFAULT_KEY);
      get.onsuccess = () => resolve((get.result as StoredDirectoryHandle | undefined) || null);
      get.onerror = () => reject(get.error);
    };
  });
}

export async function requestDirectoryPermission(handle: StoredDirectoryHandle) {
  if (await handle.queryPermission({ mode: "readwrite" }) === "granted") return true;
  return await handle.requestPermission({ mode: "readwrite" }) === "granted";
}

export async function filesFromDirectory(root: StoredDirectoryHandle) {
  const files: File[] = [];
  async function walk(directory: StoredDirectoryHandle, prefix: string) {
    for await (const entry of directory.values()) {
      if (entry.kind === "directory") {
        await walk(entry as StoredDirectoryHandle, `${prefix}${entry.name}/`);
      } else {
        const file = await (entry as FileSystemFileHandle).getFile();
        Object.defineProperty(file, "webkitRelativePath", { value: `${prefix}${file.name}`, configurable: true });
        files.push(file);
      }
    }
  }
  await walk(root, "");
  return files;
}

export async function writeFileWithoutOverwrite(
  root: StoredDirectoryHandle,
  relativePath: string,
  contents: Blob,
): Promise<"written" | "conflict"> {
  const parts = safeRelativeParts(relativePath);
  const fileName = parts.pop() as string;
  let directory: FileSystemDirectoryHandle = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  try {
    await directory.getFileHandle(fileName);
    return "conflict";
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
  return "written";
}

async function saveDirectoryHandle(handle: StoredDirectoryHandle) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, DEFAULT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
