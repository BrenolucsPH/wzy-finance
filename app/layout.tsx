import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "WZY | Suas finanças, em perspectiva",
  manifest: "/manifest.webmanifest",
  description:
    "Receitas, despesas, contas recorrentes e assinaturas compartilhadas em um só lugar.",
  icons: {
    icon: "/wzy-horse.png",
    shortcut: "/wzy-horse.png",
  },
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
