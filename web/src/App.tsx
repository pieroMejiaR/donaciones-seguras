import { RouterProvider, type createBrowserRouter } from "react-router";
import { AppProviders } from "./app/providers";
import type { AppServices } from "./app/services";

export function App({
  services,
  router,
}: {
  services: AppServices;
  router: ReturnType<typeof createBrowserRouter>;
}) {
  return (
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
