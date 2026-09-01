import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { DocumentLibraryPage } from "./pages/DocumentLibraryPage";
import { PdDocumentDetailPage } from "./pages/PdDocumentDetailPage";
import { ImportToolsPage } from "./pages/ImportToolsPage";
import { IncrementalUploadPage, UploaderAccessPage } from "./pages/IncrementalUploadPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SignInPage } from "./pages/SignInPage";

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
        <Route index element={<DocumentLibraryPage dataset="mfg" />} />
        <Route path="buy" element={<DocumentLibraryPage dataset="buy" />} />
        <Route path="documents/:dataset/:id" element={<PdDocumentDetailPage />} />
        <Route path="upload" element={<ImportToolsPage />} />
        <Route path="upload/batch" element={<IncrementalUploadPage mode="batch" />} />
        <Route path="upload/quick" element={<IncrementalUploadPage mode="quick" />} />
        <Route path="upload/sync" element={<IncrementalUploadPage mode="sync" />} />
        <Route path="upload/analysis" element={<IncrementalUploadPage mode="analysis" />} />
        <Route path="users" element={<UploaderAccessPage />} />
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  );
}
