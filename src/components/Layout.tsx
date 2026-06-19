import { NavLink, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { FeedProvider, useFeed } from "@/context/FeedContext";
import { cn } from "@/lib/utils";

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn("text-black/80 hover:text-black", isActive && "font-semibold text-black");

function Header() {
  const { refresh, refreshing } = useFeed();
  return (
    <header className="sticky top-0 z-50 bg-[#ff6600]">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
        <NavLink to="/" className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center border border-white text-xs font-bold leading-none text-white">
            J
          </span>
          <span className="font-bold text-black">news</span>
        </NavLink>
        <nav className="flex items-center gap-3 text-sm">
          <NavLink to="/" end className={navLink}>
            top
          </NavLink>
          <NavLink to="/archive" className={navLink}>
            archive
          </NavLink>
          <NavLink to="/preferences" className={navLink}>
            preferences
          </NavLink>
        </nav>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
    </header>
  );
}

export function Layout() {
  return (
    <FeedProvider>
      <div className="min-h-dvh">
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-4">
          <Outlet />
        </main>
      </div>
    </FeedProvider>
  );
}
