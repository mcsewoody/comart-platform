import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

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

    const manualInput = container.querySelector<HTMLInputElement>('input[type="file"]:not([multiple])');
    expect(manualInput).not.toBeNull();
    fireEvent.change(manualInput!, {
      target: { files: [new File(["one"], "one.pdf"), new File(["two"], "two.pdf")] },
    });
    expect(screen.getByText("每次只能上傳一個檔案，請重新選擇。")).toBeVisible();
  });
});
