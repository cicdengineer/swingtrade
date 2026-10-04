import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Seasonal Edge", description: "Indian equity seasonality research and risk management" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
