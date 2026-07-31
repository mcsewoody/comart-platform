import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

describe("App", () => {
  it("renders the product search experience in demo mode", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "找到既有產品，不從零開始",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜尋產品" })).toBeVisible();
  });
});
