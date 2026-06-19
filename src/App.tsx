import { BrowserRouter, Route, Routes } from "react-router";
import { AuthGate } from "@/components/AuthGate";
import { Layout } from "@/components/Layout";
import { ArchivePage } from "@/pages/ArchivePage";
import { HomePage } from "@/pages/HomePage";
import { PreferencesPage } from "@/pages/PreferencesPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="archive" element={<ArchivePage />} />
            <Route path="preferences" element={<PreferencesPage />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
