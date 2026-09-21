'use client';

import { useApolloClient, useMutation } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { setAuth } from '@/lib/auth';
import { REGISTER } from '@/lib/graphql';

export default function RegisterPage() {
  const router = useRouter();
  const client = useApolloClient();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [register, { loading }] = useMutation(REGISTER);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    try {
      const { data } = await register({ variables: { input: form } });
      const payload = data?.register;
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
      <h1>Crear cuenta</h1>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Nombre completo</label>
          <input id="name" className="input" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <span className="hint">Mínimo 8 caracteres, con al menos una letra y un número.</span>
        </div>
        {errors.length > 0 && <div className="notice notice--error" role="alert">{errors.map((m) => <div key={m}>{m}</div>)}</div>}
        <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
      <p className="small">¿Ya tienes cuenta? <Link href="/login">Ingresa</Link>.</p>
    </section>
  );
}
