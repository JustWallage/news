import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { AuthGate } from "@/components/AuthGate";
import { Layout } from "@/components/Layout";
import { analyticsEnabled, posthog } from "@/lib/analytics";
import { ArchivePage } from "@/pages/ArchivePage";
import { HomePage } from "@/pages/HomePage";
import { PreferencesPage } from "@/pages/PreferencesPage";

function Analytics() {
  const location = useLocation();
  useEffect(() => {
    if (analyticsEnabled) {
      posthog.capture("$pageview");
    }
  }, [location.pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <Analytics />
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
