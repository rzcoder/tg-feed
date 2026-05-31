import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { SubscriptionsPage } from '@/pages/SubscriptionsPage';
import { DestinationsPage } from '@/pages/DestinationsPage';
import { FiltersPage } from '@/pages/FiltersPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ActivityPage } from '@/pages/ActivityPage';

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route index element={<SubscriptionsPage />} />
            <Route path="destinations" element={<DestinationsPage />} />
            <Route path="filters" element={<FiltersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
