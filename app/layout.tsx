import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flare FDC Miniapp — Web2Json attestation",
  description:
    "Prove Web2 API data on-chain with the Flare Data Connector (Coston2).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
