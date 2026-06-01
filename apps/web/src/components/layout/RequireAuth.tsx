import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMe, UnauthorizedError } from '@/hooks/useAuth';
import { Spinner } from '@/components/ui/spinner';

export interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (me.error instanceof UnauthorizedError) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [me.error, navigate, location]);

  if (me.isPending) {
    return (
      <div className="grid place-items-center min-h-dvh text-text-muted">
        <Spinner />
      </div>
    );
  }

  if (me.isError) {
    // Mid-redirect — render nothing rather than an error UI.
    return null;
  }

  return <>{children}</>;
}
