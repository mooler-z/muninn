import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next;

  return (
    <div className="ad-login">
      <div className="ad-login-card">
        <span className="mn-logo mn-logo--foot" aria-hidden="true" />
        <h1>Admin</h1>
        <p>Visits and downloads for the Muninn site.</p>
        {/* Only ever an /admin path — the API checks this too, because a
            redirect target from a query string is an open-redirect otherwise. */}
        <LoginForm next={next?.startsWith("/admin") ? next : undefined} />
      </div>
    </div>
  );
}
