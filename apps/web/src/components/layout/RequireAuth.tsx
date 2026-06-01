import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useMe, UnauthorizedError } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  const isUnauthorized = me.error instanceof UnauthorizedError;

  useEffect(() => {
    if (isUnauthorized) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [isUnauthorized, navigate, location]);

  if (me.isPending) {
    return (
      <div className="grid place-items-center min-h-dvh text-text-muted">
        <Spinner />
      </div>
    );
  }

  if (me.isError) {
    // 401 → redirecting to /login via the effect above; render nothing mid-redirect.
    if (isUnauthorized) return null;
    // Any other error (network/5xx): `/me` has retry:false + staleTime:Infinity,
    // so nothing recovers on its own — offer a manual retry instead of a blank screen.
    return (
      <div className="grid place-items-center min-h-dvh px-6 text-center">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <AlertTriangle size={24} className="text-danger" />
          <p className="text-sm">Couldn’t verify your session. Check your connection.</p>
          <Button variant="secondary" size="sm" onClick={() => me.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
