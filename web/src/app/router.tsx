import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import { RequireAuth } from "../auth/RequireAuth";
import { RequireRole } from "../auth/RequireRole";
import type { UserRole } from "../auth/session";
import { Layout } from "../components/Layout";
import { CallbackPage } from "../pages/CallbackPage";
import { ForbiddenPage } from "../pages/ForbiddenPage";
import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { RouteErrorPage } from "../pages/RouteErrorPage";

function protectedPage(role: UserRole, page: ReactNode) {
  return (
    <RequireAuth>
      <RequireRole allowed={[role]}>{page}</RequireRole>
    </RequireAuth>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "callback", element: <CallbackPage /> },
      { path: "403", element: <ForbiddenPage /> },
      {
        path: "mis-donaciones",
        element: protectedPage("DONANTE", <PlaceholderPage title="Mis donaciones" />),
      },
      {
        path: "gestor",
        element: protectedPage("GESTOR", <PlaceholderPage title="Panel del gestor" />),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
