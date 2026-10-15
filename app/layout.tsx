import type { Metadata, Viewport } from "next";
import PwaRegistration from "@/components/PwaRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Partitura Studio — anotación por capas",
  description:
    "Espacio de trabajo para anotar partituras: tinta manuscrita, notas estructuradas por compás y comentarios anclados, organizados en capas independientes.",
  // Relativo, no absoluto: el `basePath` lo resuelve Next al construir, igual
  // que con los ficheros de `app/`. Ver `public/manifest.webmanifest`.
  manifest: "manifest.webmanifest",
  // «Añadir a pantalla de inicio» en iOS, que no lee el manifest.
  appleWebApp: {
    capable: true,
    title: "Partitura Studio",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "icons/apple-touch-icon.png", sizes: "180x180" }],
  },
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
  // Mismo color que `theme_color` del manifest: el de la superficie de la app.
  themeColor: "#f7f6f3",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="antialiased">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
