import type { Metadata } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["wdth"],
});

const instrument = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const description =
  "Jingwen Wang turns new AI models into things people want to try. M.S. Applied Data Science at USC.";

// 线上网址（Vercel 项目 jingwenwang）；分享卡片的图放 app/opengraph-image.png（1200×630）即可自动生效
const SITE_URL = "https://jingwenwang.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Jingwen Wang",
  description,
  openGraph: { title: "Jingwen Wang", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Jingwen Wang", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}