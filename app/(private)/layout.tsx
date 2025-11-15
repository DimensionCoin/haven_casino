// app/(private)/layout.tsx
"use client";

import React from "react";
import Header from "@/components/shared/Header";
import { CasinoProvider } from "@/providers/CasinoProvider";

export default function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Access control & redirects handled by UserProvider
  return (
    <>
      <Header />
      <main className="flex">
        <section className="flex min-h-screen w-full border-t border-dark-3">
          <CasinoProvider>
            <div className="w-full">{children}</div>
          </CasinoProvider>
        </section>
      </main>
    </>
  );
}
