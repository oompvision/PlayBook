import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Suspense } from "react";
import { ChatBubbleLoader } from "@/components/chat/chat-bubble-loader";
import "./globals.css";

export const metadata: Metadata = {
  title: "EZ Booker — Sports Facility Booking",
  description:
    "Book simulator facilities, tennis courts, and more at your favorite sports facility.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        {children}
        <Suspense fallback={null}>
          <ChatBubbleLoader />
        </Suspense>
      </body>
    </html>
  );
}
