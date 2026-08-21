import "@/styles/admin.css";

export const metadata = {
  title: "Muninn — admin",
  // The dashboard is behind a password; it should not be in an index either.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
