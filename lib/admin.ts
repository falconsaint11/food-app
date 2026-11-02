import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

// Admins are rows in app_admins; curators are trusted members admins picked
// (app_curators), who can scan menus, edit dishes and tags, and pin cover
// photos. Admins count as curators.
type Role = { isAdmin: boolean; isCurator: boolean };

const NO_ROLE: Role = { isAdmin: false, isCurator: false };

// Cached per user so switching accounts checks again.
let roleCache: { userId: string; promise: Promise<Role> } | null = null;

async function fetchRole() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NO_ROLE;
  }

  if (roleCache?.userId !== user.id) {
    const promise = (async () => {
      const [admin, curator] = await Promise.all([
        supabase.rpc('is_app_admin'),
        supabase.rpc('is_app_curator'),
      ]);

      if (admin.error || curator.error) {
        roleCache = null;
        console.log(
          'Role check error:',
          admin.error?.message ?? curator.error?.message
        );
        return NO_ROLE;
      }

      return {
        isAdmin: admin.data === true,
        isCurator: curator.data === true,
      };
    })();

    roleCache = { userId: user.id, promise };
  }

  return roleCache.promise;
}

export async function fetchIsAdmin() {
  return (await fetchRole()).isAdmin;
}

function useRole() {
  const [role, setRole] = useState(NO_ROLE);

  useEffect(() => {
    let active = true;

    fetchRole().then((value) => {
      if (active) setRole(value);
    });

    return () => {
      active = false;
    };
  }, []);

  return role;
}

export function useIsAdmin() {
  return useRole().isAdmin;
}

// True for curators and admins.
export function useIsCurator() {
  return useRole().isCurator;
}

// Admins choosing curators from someone's profile.
export async function setCurator(userId: string, on: boolean) {
  const { error } = await supabase.rpc('set_curator', {
    p_user_id: userId,
    p_on: on,
  });

  if (error) throw new Error(error.message);
}
