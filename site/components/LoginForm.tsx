"use client";

/**
 * The password form.
 *
 * Submitted with fetch rather than as a plain form post so a wrong password
 * can be answered in place — a full navigation would either lose what was
 * typed or need the password round-tripped through a query string.
 */

import { useRef, useState } from "react";

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Checked here rather than by the browser. `noValidate` on the form turns
    // off the native bubble, which was the only piece of system UI on an
    // otherwise custom page — and which Chrome refuses to show at all if it
    // cannot focus the field, logging "an invalid form control is not
    // focusable" instead of telling the user anything. Doing it ourselves puts
    // the message in the same slot as a wrong password and always lands.
    const value = field.current?.value ?? "";
    if (!value) {
      setError("Enter the password.");
      field.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const body = (await response.json()) as { error?: string; next?: string };

      if (!response.ok) {
        setError(body.error ?? "Could not sign in.");
        setBusy(false);
        return;
      }

      // A full load, not a router push: the session cookie has to be picked up
      // by the middleware, which only runs on a real request.
      window.location.href = body.next ?? "/admin";
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="ad-field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          // Kept for what it tells assistive technology; `noValidate` above is
          // what stops the browser drawing its own error on top of ours.
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-error" : undefined}
          ref={field}
          autoFocus
        />
      </div>

      <button type="submit" className="mn-glass ad-submit" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </button>

      {error ? (
        <p className="ad-error" id="password-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
