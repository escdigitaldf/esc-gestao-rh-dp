import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ESC | Gestão de RH e DP",
  description: "Plataforma inteligente de gestão de pessoas e departamento pessoal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}