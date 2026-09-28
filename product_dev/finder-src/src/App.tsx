import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { DocumentLibraryPage } from "./pages/DocumentLibraryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SignInPage } from "./pages/SignInPage";
import { useT } from "./i18n";

/* 🔴 上傳頁單獨切一塊：它自己 1,000 行，又是唯一會用到 tus-js-client 的地方，
   而大多數人開 Finder 只是查文件。文件庫是首頁，留在主 chunk 不要 lazy，
   否則第一屏會多一次 round-trip。 */
const IncrementalUploadPage = lazy(() =>
  import("./pages/IncrementalUploadPage").then((m) => ({ default: m.IncrementalUploadPage })),
);
const UploaderAccessPage = lazy(() =>
  import("./pages/IncrementalUploadPage").then((m) => ({ default: m.UploaderAccessPage })),
);
const ImportToolsPage = lazy(() =>
  import("./pages/ImportToolsPage").then((m) => ({ default: m.ImportToolsPage })),
);
const PdDocumentDetailPage = lazy(() =>
  import("./pages/PdDocumentDetailPage").then((m) => ({ default: m.PdDocumentDetailPage })),
);

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b12] text-sm font-semibold text-slate-400">
      {label}
    </div>
  );
}

export default function App() {
  const t = useT();
  const { loading, profile } = useAuth();

  if (loading) return <Splash label={t("app_verifying")} />;
  if (!profile) return <SignInPage />;

  return (
    <Suspense fallback={<Splash label={t("app_loading")} />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DocumentLibraryPage dataset="mfg" />} />
          <Route path="buy" element={<DocumentLibraryPage dataset="buy" />} />
          <Route path="documents/:dataset/:id" element={<PdDocumentDetailPage />} />
          <Route path="manual-upload" element={<IncrementalUploadPage mode="quick" />} />
          <Route path="upload" element={<ImportToolsPage />} />
          <Route path="upload/batch" element={<IncrementalUploadPage mode="batch" />} />
          <Route path="upload/quick" element={<Navigate to="/manual-upload" replace />} />
          <Route path="upload/sync" element={<IncrementalUploadPage mode="sync" />} />
          <Route path="upload/analysis" element={<IncrementalUploadPage mode="analysis" />} />
          <Route path="users" element={<UploaderAccessPage />} />
          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
