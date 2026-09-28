import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

/* 🔴 2.33 之前這兩個測試是靠 demo 模式繞過登入的（沒有 VITE_* 環境變數 →
   demoMode=true → 直接發一個假的管理員 profile）。demo 模式拿掉之後改成
   餵一份真的 session 進 localStorage、再攔 pd-documents-api ——
   等於順便把「Portal 帶 session 進來」這條路也測到了。*/
const SESSION = {
  empId: "C00001",
  nameZh: "測試",
  role: "admin",
  site: "TW",
  sig: "test-signature",
};

const PROFILE = {
  id: "C00001",
  email: "woody@comart.com.tw",
  displayName: "Woody",
  role: "admin",
  active: true,
  canUpload: true,
  canSync: true,
};

function apiStub() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const action = JSON.parse(String(init?.body ?? "{}")).action as string;
    const body =
      action === "bootstrap"
        ? { profile: PROFILE }
        : action === "search"
          ? { items: [], total: 0, elapsedMs: 3 }
          : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

beforeEach(() => {
  localStorage.setItem("comart-portal-session", JSON.stringify(SESSION));
  vi.stubGlobal("fetch", apiStub());
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the self-made document library", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "自製品文件搜尋",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜尋關鍵字" })).toBeVisible();
    expect(screen.getByRole("link", { name: "← Product Dev" })).toHaveAttribute(
      "href",
      "/product_dev/index.html",
    );
  });

  it("renders manual upload as a standalone tab and accepts only one file", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/manual-upload"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "手動上傳", level: 1 })).toBeVisible();
    expect(screen.getByRole("radio", { name: /OwnProduct/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Outsourcing/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("textbox", { name: /分類路徑/ })).not.toBeInTheDocument();

    const manualInput = container.querySelector<HTMLInputElement>('input[type="file"]:not([multiple])');
    expect(manualInput).not.toBeNull();
    fireEvent.change(manualInput!, {
      target: { files: [new File(["one"], "one.pdf"), new File(["two"], "two.pdf")] },
    });
    expect(screen.getByText("每次只能上傳一個檔案，請重新選擇。")).toBeVisible();

    fireEvent.change(manualInput!, {
      target: { files: [new File(["one"], "one.pdf")] },
    });
    expect(screen.getByRole("button", { name: "上傳這個檔案" })).toBeEnabled();
  });

  it("沒有 session 時停在登入轉接頁，不會假裝已登入", async () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "返回 COMART Platform" })).toBeVisible();
  });
});
