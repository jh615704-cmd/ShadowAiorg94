import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogoutAccessSession } from "@workspace/api-client-react";
import { useLocation } from "wouter";

export function useAccessSessionLogout() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const logoutAccess = useLogoutAccessSession();
  const logoutInFlightRef = useRef(false);

  const logout = useCallback(() => {
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    window.dispatchEvent(new Event("shadow-access-key-locked"));
    logoutAccess.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
        setLocation("/");
        logoutInFlightRef.current = false;
      },
    });
  }, [logoutAccess, queryClient, setLocation]);

  return { logout, isLoggingOut: logoutAccess.isPending };
}
