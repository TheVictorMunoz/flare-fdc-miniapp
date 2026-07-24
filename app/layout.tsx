import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proof of Anything — Flare Data Connector",
  description:
    "Turn any real-world web fact into a tamper-proof, on-chain-verified proof with a shareable link that re-verifies itself against Flare. Powered by the Flare Data Connector (Coston2).",
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
