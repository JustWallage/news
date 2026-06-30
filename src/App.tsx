import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { AuthGate } from "@/components/AuthGate";
import { Layout } from "@/components/Layout";
import { analyticsEnabled, posthog } from "@/lib/analytics";
import { ArchivePage } from "@/pages/ArchivePage";
import { DemoPage } from "@/pages/DemoPage";
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
      <Routes>
        {/* Public, ungated: the owner's live demo feed for anonymous visitors. */}
        <Route path="/demo" element={<DemoPage />} />
        <Route
          element={
            <AuthGate>
              <Layout />
            </AuthGate>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="preferences" element={<PreferencesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
