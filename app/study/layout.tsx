import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Signer Study · SignRelay",
  robots: { index: false, follow: false },
};
export default function StudyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
