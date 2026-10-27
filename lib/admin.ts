import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

// Whether the signed-in user is an app admin (a row in app_admins). Cached
// per user so switching accounts checks again.
let adminCache: { userId: string; promise: Promise<boolean> } | null = null;

export async function fetchIsAdmin() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  if (adminCache?.userId !== user.id) {
    const promise = (async () => {
      const { data, error } = await supabase.rpc('is_app_admin');

      if (error) {
        adminCache = null;
        console.log('Admin check error:', error.message);
        return false;
      }

      return data === true;
    })();

    adminCache = { userId: user.id, promise };
  }

  return adminCache.promise;
}

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;

    fetchIsAdmin().then((value) => {
      if (active) setIsAdmin(value);
    });

    return () => {
      active = false;
    };
  }, []);

  return isAdmin;
}
