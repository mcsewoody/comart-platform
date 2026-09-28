import "@testing-library/jest-dom/vitest";

/* 🔴 這個 jsdom 設定沒有 localStorage（`typeof localStorage === "undefined"`）。
   產品程式碼每一處都有 try/catch 所以不會炸，但也因此「session 存進去、下次
   讀得回來」這條路在測試裡完全走不到 —— 補一個最小實作把它打開。
   注意不是 jsdom 的 bug：Safari 封鎖儲存時真的會 throw，那些 try/catch 要留著。*/
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}
