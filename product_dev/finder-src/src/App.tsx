import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { AdminPage } from "./pages/AdminPage";
import { DocumentDetailPage } from "./pages/DocumentDetailPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SearchPage } from "./pages/SearchPage";
import { SignInPage } from "./pages/SignInPage";
import { TrashPage } from "./pages/TrashPage";
import { UploadPage } from "./pages/UploadPage";
import type { UserRole } from "./lib/types";

const roleRank: Record<UserRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

function RequireRole({
  minimum,
  children,
}: {
  minimum: UserRole;
  children: ReactNode;
}) {
  const { profile } = useAuth();
  if (!profile || roleRank[profile.role] < roleRank[minimum]) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { loading, profile, demoMode } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070b12] text-sm font-semibold text-slate-400">
        驗證登入狀態…
      </div>
    );
  }

  if (!profile && !demoMode) {
    return <SignInPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<SearchPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route
          path="upload"
          element={
            <RequireRole minimum="editor">
              <UploadPage />
            </RequireRole>
          }
        />
        <Route
          path="review"
          element={
            <RequireRole minimum="editor">
              <ReviewPage />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole minimum="admin">
              <AdminPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/trash"
          element={
            <RequireRole minimum="admin">
              <TrashPage />
            </RequireRole>
          }
        />
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  );
}
