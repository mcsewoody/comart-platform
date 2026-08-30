import { render, screen } from "@testing-library/react";
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
});
