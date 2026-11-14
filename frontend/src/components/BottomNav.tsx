/**
 * Bottom nav (UX-01, §1.4): Biblioteca, Recordatorios y Cuenta en vidrio + FAB de Guardar.
 * Activo con aria-current e ícono Fill; el resto Bold.
 */

import { Bell, Plus, SquaresFour, User, type Icon } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router";
import { t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/es-MX.ts";

interface Destination {
  to: string;
  label: MessageKey;
  icon: Icon;
  isActive: (pathname: string) => boolean;
}

const DESTINATIONS: Destination[] = [
  // Biblioteca queda activa también dentro de una carpeta (P-07).
  { to: "/", label: "nav.library", icon: SquaresFour, isActive: (p) => p === "/" || p.startsWith("/library/") },
  { to: "/reminders", label: "nav.reminders", icon: Bell, isActive: (p) => p === "/reminders" },
  { to: "/account", label: "nav.account", icon: User, isActive: (p) => p === "/account" },
];

interface Props {
  unreadCount: number;
  onSave: () => void;
}

export function BottomNav({ unreadCount, onSave }: Props) {
  const { pathname } = useLocation();
  return (
    <div className="app-nav ng-navwrap">
      <nav className="ng-nav" aria-label={t("app.name")}>
        {DESTINATIONS.map(({ to, label, icon: IconCmp, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link key={to} to={to} className="ng-nav__item" aria-current={active ? "page" : undefined}>
              <IconCmp size={22} weight={active ? "fill" : "bold"} aria-hidden />
              <span>{t(label)}</span>
              {to === "/reminders" && unreadCount > 0 && (
                <span className="ng-nav__badge" aria-label={t("nav.unread", { count: unreadCount })}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <button type="button" className="ng-fab" onClick={onSave} aria-label={t("nav.save")}>
        <Plus size={24} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
