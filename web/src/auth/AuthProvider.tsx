import type { User, UserManager } from "oidc-client-ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Env } from "../config/env";
import { AuthContext, type AuthContextValue, type AuthStatus } from "./authContext";
import { sanitizeReturnTo } from "./returnTo";
import { completeSignin, getRoles, performLogout, type UserRole } from "./session";

const SESSION_EXPIRED_NOTICE = "Tu sesión expiró. Inicia sesión de nuevo para continuar.";
const LOGIN_FAILED_NOTICE =
  "No se pudo contactar con el servicio de identidad. Inténtalo de nuevo en unos minutos.";

type Session = { status: "loading" | "anonymous" | "authenticated"; user: User | null };

function toSession(user: User | null): Session {
  return user && !user.expired
    ? { status: "authenticated", user }
    : { status: "anonymous", user: null };
}

export function AuthProvider({
  env,
  userManager,
  onSessionEnd,
  children,
}: {
  env: Env;
  userManager: UserManager;
  onSessionEnd: () => void;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session>({ status: "loading", user: null });
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loginInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let active = true;

    const expireSession = async () => {
      await userManager.removeUser();
      onSessionEnd();
      setNotice(SESSION_EXPIRED_NOTICE);
    };

    void userManager.clearStaleState();
    void userManager.getUser().then((user) => {
      // Si el callback ya cargó un usuario mientras tanto, no se pisa ese estado.
      if (active) {
        setSession((current) => (current.status === "loading" ? toSession(user) : current));
      }
    });

    const unsubscribe = [
      userManager.events.addUserLoaded((user) => {
        setNotice(null);
        setSession(toSession(user));
      }),
      userManager.events.addUserUnloaded(() => setSession(toSession(null))),
      userManager.events.addSilentRenewError(() => void expireSession()),
      userManager.events.addAccessTokenExpired(() => void expireSession()),
    ];

    return () => {
      active = false;
      unsubscribe.forEach((stop) => stop());
    };
  }, [userManager, onSessionEnd]);

  const login = useCallback(
    (returnTo: string = "/") => {
      // Una sola redirección: al reintentar se limpia el aviso, lo que también reactiva
      // el guard de RequireAuth, y un doble clic no debe iniciar dos flujos.
      if (loginInFlight.current) {
        return loginInFlight.current;
      }
      setNotice(null);
      const attempt = userManager
        .signinRedirect({ state: { returnTo: sanitizeReturnTo(returnTo) } })
        .catch(() => setNotice(LOGIN_FAILED_NOTICE))
        .finally(() => {
          loginInFlight.current = null;
        });
      loginInFlight.current = attempt;
      return attempt;
    },
    [userManager],
  );

  const logout = useCallback(async () => {
    // Mientras se cierra la sesión, los guards no deben iniciar un nuevo login.
    setSigningOut(true);
    onSessionEnd();
    await performLogout(userManager, env);
  }, [userManager, env, onSessionEnd]);

  const completeLogin = useCallback(
    (url: string) => completeSignin(userManager, url),
    [userManager],
  );

  const value = useMemo<AuthContextValue>(() => {
    const roles = getRoles(session.user);
    const status: AuthStatus = signingOut ? "signingOut" : session.status;
    return {
      status,
      notice,
      roles,
      hasRole: (role: UserRole) => roles.includes(role),
      login,
      logout,
      completeLogin,
    };
  }, [session, signingOut, notice, login, logout, completeLogin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
