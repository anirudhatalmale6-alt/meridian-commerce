import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/authContext';
import { ApiError } from '../lib/api';
import { Button, Eyebrow, Field, Notice } from '../components/ui';

function useAuthRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  // Return the shopper to wherever they were going. Dumping everyone on the
  // homepage after login is how you lose a checkout mid-flow.
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  return () => navigate(from, { replace: true });
}

export function LoginPage() {
  const { login } = useAuth();
  const redirect = useAuthRedirect();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await login(email, password);
      redirect();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account"
      title="Sign in"
      sub="Your basket follows you in — anything you added while signed out is merged with what is already saved to your account."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="link-slide text-ink">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice>{error}</Notice>}

        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <Button type="submit" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>

      {/* Demo credentials, visible because this build exists to be reviewed. */}
      <div className="mt-8 border border-dashed border-paper-edge px-4 py-4">
        <p className="label-xs mb-2.5">Demo logins</p>
        <dl className="space-y-2 text-xs text-ink-soft">
          <div className="flex justify-between gap-3">
            <dt>Shopper</dt>
            <dd className="nums text-right">shopper@example.com / Shopper!Passw0rd</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Admin</dt>
            <dd className="nums text-right">admin@example.com / Admin!Passw0rd</dd>
          </div>
        </dl>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const redirect = useAuthRedirect();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(form.email, form.password, form.name);
      redirect();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Could not create the account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account"
      title="Create an account"
      sub="So your basket, addresses and order history are waiting for you next time."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="link-slide text-ink">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice>{error}</Notice>}

        <Field
          label="Name"
          autoComplete="name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={fieldErrors.name}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={fieldErrors.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={fieldErrors.password}
          hint="At least 10 characters."
        />

        <Button type="submit" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  eyebrow,
  title,
  sub,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-14 sm:px-8 lg:grid-cols-2 lg:gap-20 lg:py-24">
      <div className="rise hidden lg:block">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 font-display text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-ink">
          {title}
        </h1>
        <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-ink-soft">{sub}</p>
        <div className="mt-10 border-t border-paper-edge pt-6">
          <p className="text-sm text-ink-soft">
            Sessions use httpOnly cookies with a rotating refresh token — no access token is ever
            readable by JavaScript on this page.
          </p>
        </div>
      </div>

      <div className="rise mx-auto w-full max-w-sm lg:mx-0" style={{ animationDelay: '90ms' }}>
        <div className="lg:hidden">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mb-6 mt-4 font-display text-4xl font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h1>
        </div>
        {children}
        <p className="mt-6 text-sm text-ink-soft">{footer}</p>
      </div>
    </div>
  );
}
