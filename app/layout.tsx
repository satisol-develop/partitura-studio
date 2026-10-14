import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Partitura Studio — anotación por capas",
  description:
    "Espacio de trabajo para anotar partituras: tinta manuscrita, notas estructuradas por compás y comentarios anclados, organizados en capas independientes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin bloquear la escala: en un móvil hay que poder ampliar con los dedos,
  // sobre todo en los paneles, que llevan texto de 10-11 px. Sobre la
  // partitura el pellizco lo gestiona la propia aplicación, que tiene que
  // poder ampliar la música sin ampliar también los botones.
  maximumScale: 5,
  // Deja que la página llegue al borde de la pantalla y que los márgenes
  // seguros (muesca, barra inferior) se gestionen con env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
