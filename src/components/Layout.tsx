import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";

export function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="bg-[#ff6600]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
          <NavLink to="/" className="font-bold text-black">
            news
          </NavLink>
          <nav className="flex items-center gap-3 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn("text-black/80", isActive && "font-semibold text-black")
              }
            >
              top
            </NavLink>
            <NavLink
              to="/preferences"
              className={({ isActive }) =>
                cn("text-black/80", isActive && "font-semibold text-black")
              }
            >
              preferences
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
