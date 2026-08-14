"use client";

import dynamic from "next/dynamic";

const PainelLegado = dynamic(() => import("@/legacy/PainelApp"), { ssr: false });

export default function Page() {
  return <PainelLegado />;
}
