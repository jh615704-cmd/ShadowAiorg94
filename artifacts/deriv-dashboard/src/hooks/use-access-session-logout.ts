import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutAccessSession } from "@workspace/api-client-react";
import { clearAccessActivity, isAccessSessionStillLocked } from "@/lib/access-lock";

export function useAccessSessionLogout() {
  const queryClient = useQueryClient();
  const logoutAccess = useLogoutAccessSession();
  const logoutInFlightRef = useRef(false);

  const logout = useCallback(() => {
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    window.dispatchEvent(new Event("shadow-access-key-locked"));
    let clearQueriesAfterLogout = false;
    logoutAccess.mutate(undefined, {
      onSuccess: () => {
        if (!isAccessSessionStillLocked()) return;
        clearQueriesAfterLogout = true;
        clearAccessActivity();
      },
      onSettled: () => {
        if (clearQueriesAfterLogout || isAccessSessionStillLocked()) queryClient.clear();
        window.dispatchEvent(new Event("shadow-access-key-logout-settled"));
        logoutInFlightRef.current = false;
      },
    });
  }, [logoutAccess, queryClient]);

  return { logout, isLoggingOut: logoutAccess.isPending };
}
