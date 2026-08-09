import { useState } from 'react'
import { supabase } from './supabase'

/** Pantalla de inicio de sesión / registro por correo y contraseña.
 * Se muestra cuando no hay una sesión de Supabase activa. */
export function AuthScreen() {
  const [modo, setModo] = useState<'login' | 'registro'>('login')
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avisoConfirmacion, setAvisoConfirmacion] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: correo, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email: correo, password })
        if (error) throw error
        setAvisoConfirmacion(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error, intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  if (avisoConfirmacion) {
    return (
      <main className="app-main auth-screen">
        <h2>Revisa tu correo</h2>
        <p className="field-hint">
          Te mandamos un enlace de confirmación a <strong>{correo}</strong>. Ábrelo desde tu
          correo y después vuelve aquí a iniciar sesión.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setAvisoConfirmacion(false)
            setModo('login')
          }}
        >
          Volver a iniciar sesión
        </button>
      </main>
    )
  }

  return (
    <main className="app-main auth-screen">
      <h1 className="auth-title">Bitácora de Obra</h1>
      <form className="entry-form" onSubmit={enviar}>
        <div className="field">
          <label htmlFor="auth-correo">Correo</label>
          <input
            id="auth-correo"
            type="email"
            autoComplete="email"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Contraseña</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="field-hint field-hint--error">{error}</p>}
        <button type="submit" className="primary" disabled={cargando}>
          {cargando ? 'Un momento…' : modo === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </form>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setError(null)
          setModo(modo === 'login' ? 'registro' : 'login')
        }}
      >
        {modo === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
      </button>
    </main>
  )
}
