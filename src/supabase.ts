import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // No es un error fatal: la app sigue cargando, pero el login no va a
  // funcionar hasta que se configuren estas dos variables de entorno.
  console.warn(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — el inicio de sesión no funcionará hasta configurarlas.',
  )
}

// Estas dos claves son públicas por diseño (van embebidas en el bundle del
// navegador): la seguridad real la dan las políticas de Row Level Security
// en Supabase, no mantener esto en secreto.
export const supabase = createClient(url ?? '', anonKey ?? '')
