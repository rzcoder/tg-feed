import { Outlet, useLocation } from 'react-router-dom';
import { StreamProvider } from '@/hooks/useActivityStream';
import { Sidebar } from './Sidebar';
import { TabBar, NAV_TABS } from './TabBar';
import { TopBar } from './TopBar';
import { RequireAuth } from './RequireAuth';

function pageFromPath(pathname: string) {
  return NAV_TABS.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));
}

export function AppShell() {
  const location = useLocation();
  const page = pageFromPath(location.pathname);
  const title = page?.full ?? 'tg-feed';

  return (
    <RequireAuth>
      <StreamProvider>
        <div className="h-dvh w-screen flex bg-bg text-text overflow-hidden">
          <Sidebar className="hidden lg:flex" />
          <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
            <TopBar title={title} icon={page?.icon} />
            <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
              <Outlet />
            </main>
            <TabBar className="lg:hidden" />
          </div>
        </div>
      </StreamProvider>
    </RequireAuth>
  );
}
