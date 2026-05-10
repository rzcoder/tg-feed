import { Outlet, useLocation } from 'react-router-dom';
import { StreamProvider } from '@/hooks/useActivityStream';
import { Sidebar } from './Sidebar';
import { TabBar, NAV_TABS } from './TabBar';
import { TopBar } from './TopBar';
import { RequireAuth } from './RequireAuth';

function pageTitleFromPath(pathname: string): string {
  const match = NAV_TABS.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));
  return match?.full ?? 'tg-feed';
}

export function AppShell() {
  const location = useLocation();
  const title = pageTitleFromPath(location.pathname);

  return (
    <RequireAuth>
      <StreamProvider>
        <div className="h-screen w-screen flex bg-bg text-text overflow-hidden">
          <Sidebar className="hidden lg:flex" />
          <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
            <TopBar title={title} />
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
