/** Rutas de la SPA (Diseño UX §1.5). Bottom nav solo en P-02, P-05, P-06 y P-07 (§1.4). */

import { createBrowserRouter, RouterProvider } from "react-router";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import { NavLayout, RootLayout } from "./components/Layouts.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { AuthCallbackPage } from "./pages/AuthCallbackPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import {
  FolderPage,
  ItemEditPage,
  ItemPage,
  LibraryPage,
  NotFoundPage,
  RemindersPage,
} from "./pages/placeholders.tsx";

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/auth/callback", element: <AuthCallbackPage /> }, // P-00
      { path: "/login", element: <LoginPage /> }, // P-01
      {
        element: <RequireAuth />,
        children: [
          {
            element: <NavLayout />,
            children: [
              { path: "/", element: <LibraryPage /> }, // P-02
              { path: "/library/:category", element: <FolderPage /> }, // P-07
              { path: "/reminders", element: <RemindersPage /> }, // P-06
              { path: "/account", element: <AccountPage /> }, // P-05
            ],
          },
          { path: "/items/:videoId", element: <ItemPage /> }, // P-03
          { path: "/items/:videoId/edit", element: <ItemEditPage /> }, // P-04
        ],
      },
      { path: "*", element: <NotFoundPage /> }, // P-404
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
