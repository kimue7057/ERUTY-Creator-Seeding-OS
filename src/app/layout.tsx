import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "ERUTY · Creator Seeding OS", template: "%s · ERUTY" }, description: "브랜드와 크리에이터를 연결하는 시딩 운영 워크스페이스" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
