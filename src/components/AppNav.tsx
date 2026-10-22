"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "脚本编辑" },
  { href: "/assets", label: "资源管理" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="主导航">
      {LINKS.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link${active ? " active" : ""}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
