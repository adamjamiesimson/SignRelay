import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Development Capture · SignRelay",
  robots: { index: false, follow: false },
};
export default function FieldTestLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
