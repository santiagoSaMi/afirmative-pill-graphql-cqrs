'use client';

import { useApolloClient, useMutation } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { setAuth } from '@/lib/auth';
import { LOGIN } from '@/lib/graphql';

export default function LoginPage() {
  const router = useRouter();
  const client = useApolloClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [login, { loading }] = useMutation(LOGIN);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    try {
      const { data } = await login({ variables: { input: { email, password } } });
      const payload = data?.login;
      if (payload?.errors?.length) return setErrors(payload.errors.map((x: { message: string }) => x.message));
      await client.clearStore();
      setAuth({ token: payload.token, user: payload.user });
      const next = sessionStorage.getItem('ap.next') ?? '/';
      sessionStorage.removeItem('ap.next');
      router.push(next);
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  }

  return (
    <section className="panel stack authbox">
      <h1>Ingresar</h1>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {errors.length > 0 && <div className="notice notice--error" role="alert">{errors.map((m) => <div key={m}>{m}</div>)}</div>}
        <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
      <p className="small">¿No tienes cuenta? <Link href="/register">Crea una</Link>.</p>
    </section>
  );
}
