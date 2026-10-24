import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { useSession } from '@/hooks/use-session';
import {
  loadWorkspaceIdentity,
  type WorkspaceIdentity,
} from '@/lib/organization';

type State = {
  identity: WorkspaceIdentity | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
const Context = createContext<State>({
  identity: null,
  loading: true,
  error: '',
  refresh: async () => {},
});
export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { session, isLoading } = useSession();
  const userId = session?.user.id || null;
  const [snapshot, setSnapshot] = useState<{
    userId: string | null;
    identity: WorkspaceIdentity | null;
    error: string;
  }>({ userId: null, identity: null, error: '' });
  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const identity = await loadWorkspaceIdentity();
      setSnapshot({ userId, identity, error: '' });
    } catch (e) {
      setSnapshot({ userId, identity: null, error: (e as Error).message });
    }
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const load = async () => {
      try {
        const identity = await loadWorkspaceIdentity();
        if (live) setSnapshot({ userId, identity, error: '' });
      } catch (e) {
        if (live)
          setSnapshot({ userId, identity: null, error: (e as Error).message });
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [userId]);
  const current = snapshot.userId === userId;
  return (
    <Context.Provider
      value={{
        identity: current ? snapshot.identity : null,
        error: current ? snapshot.error : '',
        loading: isLoading || (!!userId && !current),
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useWorkspace = () => useContext(Context);
