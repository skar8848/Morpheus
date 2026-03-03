import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Web3Provider from "@/lib/web3/provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Morpho — Strategy Visualizer",
  description: "Compose yield strategies on Morpho",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
