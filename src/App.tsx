import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Session } from '@supabase/supabase-js'
import {
  db,
  blobsAAlmacenar,
  almacenadasABlobs,
  type EntradaCola,
  type EstadoObservacion,
  type TipoEntrada,
} from './db'
import { supabase } from './supabase'
import { listarObras, crearObra, actualizarObra, eliminarObra, type Obra } from './obrasApi'
import { listarMiembros, invitarMiembro, quitarMiembro, type Miembro } from './miembrosApi'
import {
  listarEntradas,
  crearEntrada,
  subirFotosDeEntrada,
  actualizarEstadoObservacion,
  eliminarEntrada,
  descargarFotoEntrada,
  type EntradaRemota,
} from './entradasApi'
import { listarNombresSemana, renombrarSemana } from './semanasApi'
import { AuthScreen } from './AuthScreen'
import { leerFechaExif } from './exif'
import { obtenerResumenIA } from './resumenApi'
import type { EntradaReporte, ObservacionReporte } from './pdf'
import {
  IconEditar,
  IconEliminar,
  IconSalir,
  IconAdvertencia,
  IconSubiendo,
  IconUsuario,
  IconDocumento,
  IconCerrar,
  IconEdificio,
  IconDiario,
  IconCarpeta,
  IconFlechaIzquierda,
  IconFlechaDerecha,
  IconMas,
} from './icons'
import './App.css'

const ESTADOS_OBSERVACION: { valor: EstadoObservacion; etiqueta: string }[] = [
  { valor: 'por_atender', etiqueta: 'Por atender' },
  { valor: 'en_proceso', etiqueta: 'En proceso' },
  { valor: 'atendido', etiqueta: 'Atendido' },
]

function etiquetaEstado(estado: EstadoObservacion): string {
  return ESTADOS_OBSERVACION.find((e) => e.valor === estado)?.etiqueta ?? estado
}

const PALETA_COLORES = [
  '#e67e22', // naranja casco (color de marca)
  '#2980b9',
  '#27ae60',
  '#c0392b',
  '#8e44ad',
  '#f1c40f',
  '#16a085',
  '#7f8c8d',
]

function toInputValue(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/** Arma un mensaje de error lo más completo posible: los errores de
 * Supabase (auth/DB/storage) traen un `toJSON()` con código y status, que
 * `err.message` solo no muestra — sin eso es casi imposible saber si algo
 * falló por permisos, por la tabla, por el bucket, etc. */
function mensajeDeError(err: unknown): string {
  if (err && typeof err === 'object') {
    try {
      const detalle = JSON.stringify(err)
      if (detalle && detalle !== '{}') return detalle
    } catch {
      // sigue al mensaje simple de abajo
    }
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}

/** Distingue "no hay señal" (vale la pena guardar en la cola local y
 * reintentar sola) de un error real del servidor (permisos, tabla mal
 * configurada, etc. — reintentar solo no lo va a arreglar, hay que avisar). */
function esErrorDeConexion(err: unknown): boolean {
  if (!navigator.onLine) return true
  // fetch() lanza TypeError cuando no logra ni conectar (sin señal, DNS,
  // CORS bloqueado); los errores que sí devuelve el servidor (RLS, SQL,
  // etc.) llegan como un objeto con código/mensaje, no como TypeError.
  return err instanceof TypeError
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Crea (y limpia) una URL local para mostrar un Blob guardado en IndexedDB. */
function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return url
}

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ícono redondo de una obra: su imagen si tiene, si no un círculo de color
 * con la inicial del nombre. `imagenSrc` puede ser una URL remota (obra ya
 * guardada) o una URL local blob: (preview de una imagen recién elegida,
 * todavía sin subir). */
function ObraIcono({
  nombre,
  color,
  imagenSrc,
  tamano = 56,
}: {
  nombre: string
  color: string
  imagenSrc?: string | null
  tamano?: number
}) {
  const estilo = {
    width: tamano,
    height: tamano,
    fontSize: tamano * 0.4,
    background: imagenSrc ? undefined : color || '#e67e22',
  }
  return (
    <span className="obra-icono" style={estilo}>
      {imagenSrc ? (
        <img src={imagenSrc} alt="" />
      ) : (
        nombre.trim().charAt(0).toUpperCase() || <IconEdificio size={tamano * 0.5} />
      )}
    </span>
  )
}

/** Formulario para crear o editar una obra: nombre, color e imagen del ícono.
 * Las obras viven en Supabase — este formulario llama a obrasApi y avisa
 * al padre para que recargue la lista cuando termina. */
function ObraForm({
  obraExistente,
  onGuardar,
  onCancelar,
  onEliminar,
}: {
  obraExistente?: Obra
  onGuardar: () => void
  onCancelar: () => void
  onEliminar?: (id: string) => Promise<void>
}) {
  const [nombre, setNombre] = useState(obraExistente?.nombre ?? '')
  const [color, setColor] = useState(obraExistente?.color ?? PALETA_COLORES[0])
  const [imagenBlob, setImagenBlob] = useState<Blob | undefined>(undefined)
  const [imagenExistente, setImagenExistente] = useState<string | null>(obraExistente?.imagenUrl ?? null)
  const [empresa, setEmpresa] = useState(obraExistente?.empresa ?? '')
  const [empresaDatos, setEmpresaDatos] = useState(obraExistente?.empresaDatos ?? '')
  const [logoBlob, setLogoBlob] = useState<Blob | undefined>(undefined)
  const [logoExistente, setLogoExistente] = useState<string | null>(obraExistente?.logoUrl ?? null)
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewLocal = useBlobUrl(imagenBlob)
  const previewLogo = useBlobUrl(logoBlob)

  const [miembros, setMiembros] = useState<Miembro[] | null>(null)
  const [correoInvitar, setCorreoInvitar] = useState('')
  const [invitando, setInvitando] = useState(false)
  const [errorMiembros, setErrorMiembros] = useState<string | null>(null)

  useEffect(() => {
    if (!obraExistente) return
    listarMiembros(obraExistente.id)
      .then(setMiembros)
      .catch((err) => console.error('Error cargando colaboradores:', err))
  }, [obraExistente])

  async function agregarMiembro() {
    if (!obraExistente || !correoInvitar.trim()) return
    setInvitando(true)
    setErrorMiembros(null)
    try {
      await invitarMiembro(obraExistente.id, correoInvitar)
      setCorreoInvitar('')
      setMiembros(await listarMiembros(obraExistente.id))
    } catch (err) {
      setErrorMiembros(err instanceof Error ? err.message : 'No se pudo agregar. Intenta de nuevo.')
    } finally {
      setInvitando(false)
    }
  }

  async function eliminarMiembro(userId: string) {
    if (!obraExistente) return
    try {
      await quitarMiembro(obraExistente.id, userId)
      setMiembros(await listarMiembros(obraExistente.id))
    } catch (err) {
      setErrorMiembros(err instanceof Error ? err.message : 'No se pudo quitar. Intenta de nuevo.')
    }
  }

  function handleImagen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setImagenBlob(file)
  }

  function quitarImagen() {
    setImagenBlob(undefined)
    setImagenExistente(null)
  }

  function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setLogoBlob(file)
  }

  function quitarLogo() {
    setLogoBlob(undefined)
    setLogoExistente(null)
  }

  async function guardar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      alert('Ponle un nombre a la obra.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const datos = {
        nombre: nombreLimpio,
        color,
        empresa,
        empresaDatos,
        imagenBlob,
        logoBlob,
        quitarImagen: !imagenBlob && !imagenExistente && !!obraExistente?.imagenUrl,
        quitarLogo: !logoBlob && !logoExistente && !!obraExistente?.logoUrl,
      }
      if (obraExistente) {
        await actualizarObra(obraExistente.id, datos)
      } else {
        await crearObra(datos)
      }
      onGuardar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la obra. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!obraExistente || !onEliminar) return
    const confirmado = confirm(
      `¿Borrar "${obraExistente.nombre}"? Se perderán sus datos en la nube y las entradas guardadas en este celular para esta obra. Esta acción no se puede deshacer.`
    )
    if (!confirmado) return
    setEliminando(true)
    setError(null)
    try {
      await onEliminar(obraExistente.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la obra. Intenta de nuevo.')
      setEliminando(false)
    }
  }

  return (
    <div className="obra-form">
      <div className="obra-form-preview">
        <ObraIcono nombre={nombre} color={color} imagenSrc={previewLocal ?? imagenExistente} tamano={84} />
      </div>

      <div className="field">
        <label htmlFor="obra-nombre">Nombre de la obra</label>
        <input
          id="obra-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Residencial Las Palmas"
        />
      </div>

      <div className="field">
        <label>Imagen del ícono (opcional)</label>
        <input type="file" accept="image/*" onChange={handleImagen} />
        {(imagenBlob || imagenExistente) && (
          <button type="button" className="secondary small" onClick={quitarImagen}>
            Quitar imagen
          </button>
        )}
      </div>

      <div className="field">
        <label>Color del ícono</label>
        <div className="color-swatches">
          {PALETA_COLORES.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Elegir color ${c}`}
            />
          ))}
          <input
            type="color"
            className="color-swatch color-swatch--custom"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Otro color"
            aria-label="Elegir otro color"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="obra-empresa">Empresa (opcional)</label>
        <input
          id="obra-empresa"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          placeholder="Nombre de tu empresa"
        />
        <p className="field-hint">Aparece junto con el logo en todos los PDF que generes de esta obra.</p>
      </div>

      <div className="field">
        <label htmlFor="obra-empresa-datos">Datos de la empresa (opcional)</label>
        <textarea
          id="obra-empresa-datos"
          rows={3}
          value={empresaDatos}
          onChange={(e) => setEmpresaDatos(e.target.value)}
          placeholder={'Dirección, teléfono, correo de contacto…'}
        />
        <p className="field-hint">También aparecen junto al logo en el encabezado del PDF.</p>
      </div>

      <div className="field">
        <label>Logo de la empresa (opcional)</label>
        {(previewLogo ?? logoExistente) && (
          <img className="logo-preview" src={previewLogo ?? logoExistente ?? undefined} alt="Logo de la empresa" />
        )}
        <input type="file" accept="image/*" onChange={handleLogo} />
        {(logoBlob || logoExistente) && (
          <button type="button" className="secondary small" onClick={quitarLogo}>
            Quitar logo
          </button>
        )}
      </div>

      {obraExistente && (
        <div className="field">
          <label>Colaboradores</label>
          <p className="field-hint">
            Pueden entrar a esta obra a agregar notas y observaciones. Deben tener ya una cuenta creada en la app
            con el correo que escribas aquí.
          </p>
          {miembros === null && <p className="field-hint">Cargando…</p>}
          {miembros && miembros.length > 0 && (
            <ul className="miembros-lista">
              {miembros.map((m) => (
                <li key={m.userId}>
                  <span>{m.email}</span>
                  <button
                    type="button"
                    className="miembro-quitar"
                    onClick={() => eliminarMiembro(m.userId)}
                    aria-label={`Quitar a ${m.email}`}
                  >
                    <IconCerrar size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {miembros && miembros.length === 0 && <p className="field-hint">Todavía no agregas a nadie.</p>}
          <div className="miembros-agregar">
            <input
              type="email"
              value={correoInvitar}
              onChange={(e) => setCorreoInvitar(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
            <button type="button" className="secondary small" onClick={agregarMiembro} disabled={invitando}>
              {invitando ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
          {errorMiembros && <p className="field-hint field-hint--error">{errorMiembros}</p>}
        </div>
      )}

      {error && <p className="field-hint field-hint--error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancelar} disabled={guardando || eliminando}>
          Cancelar
        </button>
        <button type="button" className="primary" onClick={guardar} disabled={guardando || eliminando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {obraExistente && onEliminar && (
        <button type="button" className="danger-link" onClick={eliminar} disabled={guardando || eliminando}>
          <IconEliminar size={15} />
          {eliminando ? 'Borrando…' : 'Borrar esta obra'}
        </button>
      )}
    </div>
  )
}

/** Tarjeta de una obra en la página de inicio. El lápiz de editar solo
 * aparece si la creaste tú — los colaboradores agregados por el dueño
 * pueden entrar a trabajar en ella, pero no cambiar su configuración. */
function ObraCard({
  obra,
  esDueno,
  onEntrar,
  onEditar,
}: {
  obra: Obra
  esDueno: boolean
  onEntrar: () => void
  onEditar: () => void
}) {
  return (
    <div className="obra-card">
      <button type="button" className="obra-card-main" onClick={onEntrar}>
        <ObraIcono nombre={obra.nombre} color={obra.color} imagenSrc={obra.imagenUrl} />
        <span className="obra-card-nombre">{obra.nombre}</span>
      </button>
      {esDueno && (
        <button type="button" className="obra-card-editar" onClick={onEditar} aria-label={`Editar ${obra.nombre}`}>
          <IconEditar size={14} />
        </button>
      )}
    </div>
  )
}

/** Página de inicio: lista de obras (ya cargadas por el padre) + crear/editar. */
function HomeScreen({
  obras,
  cargando,
  userId,
  onEntrarObra,
  onCambiaronObras,
}: {
  obras: Obra[] | null
  cargando: boolean
  userId: string
  onEntrarObra: (id: string) => void
  onCambiaronObras: () => void
}) {
  const [formulario, setFormulario] = useState<'nueva' | string | null>(null)

  if (formulario !== null) {
    const editando = typeof formulario === 'string' ? obras?.find((o) => o.id === formulario) : undefined
    return (
      <main className="app-main">
        <h2>{editando ? 'Editar obra' : 'Nueva obra'}</h2>
        <ObraForm
          obraExistente={editando}
          onGuardar={() => {
            setFormulario(null)
            onCambiaronObras()
          }}
          onCancelar={() => setFormulario(null)}
          onEliminar={async (id) => {
            await eliminarObra(id)
            setFormulario(null)
            onCambiaronObras()
          }}
        />
      </main>
    )
  }

  return (
    <main className="app-main">
      <h2>Mis obras</h2>
      {cargando && <p className="empty-state">Cargando tus obras…</p>}
      <div className="obra-grid">
        {obras?.map((o) => (
          <ObraCard
            key={o.id}
            obra={o}
            esDueno={o.creadoPor === userId}
            onEntrar={() => onEntrarObra(o.id)}
            onEditar={() => setFormulario(o.id)}
          />
        ))}
        <button type="button" className="obra-card-nueva" onClick={() => setFormulario('nueva')}>
          <span className="obra-icono obra-icono--nueva">
            <IconMas size={22} />
          </span>
          <span className="obra-card-nombre">Nueva obra</span>
        </button>
      </div>
      {!cargando && obras && obras.length === 0 && (
        <p className="empty-state">Crea tu primera obra para empezar a registrar evidencia, o pídele al dueño de una obra que te agregue como colaborador.</p>
      )}
    </main>
  )
}

/** Menú de una obra: por ahora solo tiene el Diario de obra (notas,
 * observaciones y reportes), pero queda listo para agregar más apartados
 * más adelante sin tener que rehacer la navegación. */
function ObraMenu({ obra, onAbrirDiario }: { obra: Obra; onAbrirDiario: () => void }) {
  return (
    <main className="app-main">
      <div className="obra-menu-cabecera">
        <ObraIcono nombre={obra.nombre} color={obra.color} imagenSrc={obra.imagenUrl} tamano={60} />
        <div>
          <h2>{obra.nombre}</h2>
          {obra.empresa?.trim() && <p className="obra-menu-empresa">{obra.empresa}</p>}
        </div>
      </div>

      <nav className="obra-menu-lista">
        <button type="button" className="obra-menu-item" onClick={onAbrirDiario}>
          <span className="obra-menu-item-icono">
            <IconDiario />
          </span>
          <span className="obra-menu-item-texto">
            <strong>Diario de obra</strong>
            <span>Notas, observaciones y reportes</span>
          </span>
          <IconFlechaDerecha className="obra-menu-item-flecha" />
        </button>
      </nav>
    </main>
  )
}

/** Miniatura de una foto. Si se pasa `onQuitar`, muestra el botón para
 * quitarla (formulario de captura); si no, es de solo lectura (vista previa
 * del reporte, donde solo el texto es editable). */
function PhotoThumb({ blob, onQuitar }: { blob: Blob; onQuitar?: () => void }) {
  const url = useBlobUrl(blob)
  return (
    <div className="photo-thumb">
      {url && <img src={url} alt="" />}
      {onQuitar && (
        <button type="button" className="photo-thumb-quitar" onClick={onQuitar} aria-label="Quitar foto">
          <IconCerrar size={11} />
        </button>
      )}
    </div>
  )
}

/** Formulario para agregar una nota o una observación. Son casi idénticos
 * (fecha, fotos, texto) — la observación además arranca con un estatus. Si
 * no hay señal (o el guardado falla por conexión), se guarda en este
 * celular y una tarea de fondo la sube sola en cuanto vuelva el internet. */
function EntradaForm({
  obraId,
  tipo,
  onGuardado,
  onClose,
}: {
  obraId: string
  tipo: TipoEntrada
  /** Se llama justo después de guardarse en Supabase, para refrescar la
   * lista al instante en vez de esperar a que se vuelva a entrar a la obra. */
  onGuardado: () => void
  onClose: () => void
}) {
  const [fecha, setFecha] = useState(toInputValue(new Date()))
  const [fechaAuto, setFechaAuto] = useState<'detectada' | 'no-detectada' | null>(null)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<EstadoObservacion>('por_atender')
  const [fotos, setFotos] = useState<Blob[]>([])
  const [guardando, setGuardando] = useState(false)

  async function handleFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setFotos((prev) => [...prev, ...files])

    // Se intenta leer la fecha real en que se tomó la primera foto (EXIF)
    // para no tener que escribirla a mano. Si no trae esa metadata (PNG,
    // captura de pantalla, WhatsApp la borra al comprimir, etc.) se avisa
    // y el usuario la ajusta manualmente. Solo se hace la primera vez que
    // se agregan fotos a esta entrada.
    if (fechaAuto === null) {
      const fechaFoto = await leerFechaExif(files[0])
      if (fechaFoto) {
        setFecha(toInputValue(fechaFoto))
        setFechaAuto('detectada')
      } else {
        setFechaAuto('no-detectada')
      }
    }

    e.target.value = '' // permite volver a elegir la misma foto si se quita y se re-agrega
  }

  function quitarFoto(index: number) {
    setFotos((prev) => prev.filter((_, i) => i !== index))
  }

  async function guardar() {
    if (!texto.trim() && fotos.length === 0) {
      alert(tipo === 'nota' ? 'Agrega al menos una foto o una nota antes de guardar.' : 'Describe la observación o agrega al menos una foto.')
      return
    }
    setGuardando(true)
    const datos = {
      obraId,
      tipo,
      fecha,
      texto: texto.trim() || undefined,
      fotos,
      estado: tipo === 'observacion' ? estado : undefined,
    }
    // `idParcial` se llena en cuanto el renglón queda creado en Supabase,
    // aunque después falle la subida de fotos — así, si hay que reintentar,
    // se completa ese mismo renglón en vez de crear uno repetido (antes
    // cada reintento insertaba una nota nueva).
    let idParcial: string | undefined
    try {
      await crearEntrada(datos, (id) => {
        idParcial = id
      })
      onGuardado()
    } catch (err) {
      const conexion = esErrorDeConexion(err)
      const mensaje = mensajeDeError(err)
      // Se guarda en la cola local pase lo que pase, para no perder el
      // trabajo ya escrito: si fue solo falta de señal se sube sola después;
      // si fue un error real se queda marcada con ⚠️ para reintentar a mano.
      const paraCola: EntradaCola = {
        ...datos,
        // Se guarda como ArrayBuffer, no como Blob directo — algunos
        // navegadores (sobre todo Safari/iOS) devuelven Blobs vacíos al
        // leerlos de vuelta de IndexedDB después de un rato; el ArrayBuffer
        // no tiene ese problema.
        fotos: await blobsAAlmacenar(datos.fotos),
        creadoEn: new Date().toISOString(),
        remotaIdParcial: idParcial,
        ultimoError: conexion ? undefined : mensaje,
      }
      await db.entradasCola.add(paraCola)
      if (conexion) {
        console.warn('Sin conexión, se deja en la cola local:', err)
      } else {
        console.error('No se pudo guardar en línea, se deja pendiente para reintentar:', err)
        alert(
          `No se pudo terminar de guardar (${mensaje}). Tu ${tipo === 'nota' ? 'nota' : 'observación'} se quedó a salvo en este celular — toca el aviso en la tarjeta para reintentar o ver el detalle.`,
        )
      }
    }
    setGuardando(false)
    onClose()
  }

  return (
    <div className="entry-form">
      <div className="field">
        <label htmlFor="fecha">Fecha del registro</label>
        <input
          id="fecha"
          type="datetime-local"
          value={fecha}
          onChange={(e) => {
            setFecha(e.target.value)
            setFechaAuto(null)
          }}
        />
        {fechaAuto === 'detectada' && (
          <p className="field-hint field-hint--ok">Fecha detectada de la foto ✓</p>
        )}
        {fechaAuto === 'no-detectada' && (
          <p className="field-hint">La foto no trae fecha guardada — revisa que sea correcta.</p>
        )}
      </div>

      <div className="photo-picker">
        <label>Fotos</label>
        {fotos.length > 0 && (
          <div className="photo-thumbs">
            {fotos.map((foto, i) => (
              <PhotoThumb key={i} blob={foto} onQuitar={() => quitarFoto(i)} />
            ))}
          </div>
        )}
        {/* Sin el atributo `capture`: así el celular deja elegir entre
            tomar una foto nueva o escoger una o varias ya existentes de la
            galería. `multiple` permite agregar varias de una sola vez. */}
        <input type="file" accept="image/*" multiple onChange={handleFotos} />
      </div>

      <div className="field">
        <label htmlFor="texto">{tipo === 'nota' ? 'Nota escrita' : 'Descripción de la observación'}</label>
        <textarea
          id="texto"
          rows={3}
          placeholder={
            tipo === 'nota'
              ? '¿Qué pasó en obra hoy? (tip: usa el micrófono de tu teclado para dictar)'
              : '¿Qué se observó? ¿Qué hace falta corregir? (tip: usa el micrófono de tu teclado para dictar)'
          }
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      {tipo === 'observacion' && (
        <div className="field">
          <label htmlFor="estado-inicial">Estatus</label>
          <select id="estado-inicial" value={estado} onChange={(e) => setEstado(e.target.value as EstadoObservacion)}>
            {ESTADOS_OBSERVACION.map((op) => (
              <option key={op.valor} value={op.valor}>
                {op.etiqueta}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

/** Descarga (y cachea localmente) una foto guardada en el bucket privado de
 * Supabase, para poder mostrarla como cualquier otra imagen. */
function useFotoRemota(ruta: string): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(null)
  useEffect(() => {
    let cancelado = false
    setBlob(null)
    ;(async () => {
      const enCache = await db.fotosCache.get(ruta)
      if (enCache) {
        if (!cancelado) setBlob(enCache.blob)
        return
      }
      const descargada = await descargarFotoEntrada(ruta)
      if (descargada && !cancelado) {
        await db.fotosCache.put({ ruta, blob: descargada })
        setBlob(descargada)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [ruta])
  return blob
}

function EntradaThumbRemota({ ruta, extra }: { ruta: string; extra: number }) {
  const blob = useFotoRemota(ruta)
  const url = useBlobUrl(blob)
  return (
    <div className="entry-thumb-wrap">
      {url ? <img className="entry-thumb" src={url} alt="" /> : <div className="entry-thumb entry-thumb-cargando" />}
      {extra > 0 && <span className="entry-thumb-badge">+{extra}</span>}
    </div>
  )
}

/** Representación única de una nota/observación sin importar si ya está en
 * Supabase o si todavía está pendiente de subir desde este celular. */
interface EntradaVista {
  claveLocal: string
  remotaId?: string
  colaId?: number
  tipo: TipoEntrada
  autorEmail: string | null
  fecha: string
  texto: string | null
  estado: EstadoObservacion | null
  fotos: string[]
  fotosLocales: Blob[]
  pendienteDeSubir: boolean
  ultimoError?: string
}

function vistaDeRemota(e: EntradaRemota): EntradaVista {
  return {
    claveLocal: e.id,
    remotaId: e.id,
    tipo: e.tipo,
    autorEmail: e.autorEmail,
    fecha: e.fecha,
    texto: e.texto,
    estado: e.estado,
    fotos: e.fotos,
    fotosLocales: [],
    pendienteDeSubir: false,
  }
}

function vistaDeCola(e: EntradaCola & { id: number }): EntradaVista {
  return {
    claveLocal: `cola-${e.id}`,
    colaId: e.id,
    tipo: e.tipo,
    autorEmail: null,
    fecha: e.fecha,
    texto: e.texto ?? null,
    estado: e.estado ?? null,
    fotos: [],
    fotosLocales: almacenadasABlobs(e.fotos),
    pendienteDeSubir: true,
    ultimoError: e.ultimoError,
  }
}

/** Trae las notas/observaciones de una obra desde Supabase (para que se
 * vean igual para todo el equipo), las mezcla con lo que este celular tenga
 * pendiente de subir, y guarda una copia local para poder seguir viendo la
 * bitácora sin conexión. También reintenta subir lo pendiente cuando vuelve
 * la señal. */
function useEntradasObra(obraId: string | null, tipo: TipoEntrada, online: boolean) {
  const [remotas, setRemotas] = useState<EntradaRemota[]>([])
  const [cargando, setCargando] = useState(true)

  const pendientesCola =
    useLiveQuery(() => {
      if (!obraId) return [] as (EntradaCola & { id: number })[]
      return db.entradasCola.where({ obraId, tipo }).toArray() as Promise<(EntradaCola & { id: number })[]>
    }, [obraId, tipo]) ?? []

  async function cargar() {
    if (!obraId) return
    setCargando(true)
    try {
      const datos = await listarEntradas(obraId, tipo)
      setRemotas(datos)
      await db.entradasCache.where({ obraId, tipo }).delete()
      if (datos.length > 0) await db.entradasCache.bulkPut(datos)
    } catch (err) {
      console.error('Sin conexión con el servidor, se muestra la última copia guardada:', err)
      const cache = await db.entradasCache.where({ obraId, tipo }).toArray()
      setRemotas(cache)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, tipo])

  /** Intenta subir lo que este celular tiene pendiente. Si falla por falta
   * de señal se deja como estaba, para reintentar después sin alarmar; si
   * falla por otra razón (permisos, tabla mal configurada…) se guarda el
   * error en el mismo renglón para poder avisarlo en la tarjeta, en vez de
   * reintentar en silencio para siempre sin que nadie se entere. */
  async function intentarSubirCola() {
    if (!obraId) return
    const cola = await db.entradasCola.where({ obraId, tipo }).toArray()
    let subioAlguna = false
    for (const item of cola) {
      try {
        const fotos = almacenadasABlobs(item.fotos)
        if (item.remotaIdParcial) {
          // El renglón ya existe en Supabase (solo faltaban las fotos): no
          // se vuelve a insertar, para no duplicar la nota — solo se
          // termina de subir lo que falte.
          if (fotos.length > 0) {
            await subirFotosDeEntrada(item.obraId, item.remotaIdParcial, fotos)
          }
        } else {
          await crearEntrada(
            {
              obraId: item.obraId,
              tipo: item.tipo,
              fecha: item.fecha,
              texto: item.texto,
              fotos,
              estado: item.estado,
            },
            async (id) => {
              await db.entradasCola.update(item.id!, { remotaIdParcial: id })
            },
          )
        }
        await db.entradasCola.delete(item.id!)
        subioAlguna = true
      } catch (err) {
        if (esErrorDeConexion(err)) {
          console.warn('Todavía sin señal, se reintentará después:', err)
        } else {
          console.error('No se pudo subir una entrada pendiente:', err)
          await db.entradasCola.update(item.id!, {
            ultimoError: mensajeDeError(err),
          })
        }
      }
    }
    if (subioAlguna) cargar()
  }

  // Reintenta: al entrar a la obra, cuando el navegador avisa que volvió la
  // señal, cada 20s mientras se está viendo esta lista (por si el aviso de
  // "volvió la señal" no llega, algo común en celulares) y al regresar a la
  // pestaña/app desde segundo plano.
  useEffect(() => {
    if (online) intentarSubirCola()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, obraId, tipo])

  useEffect(() => {
    if (!obraId) return
    const intervalo = setInterval(() => {
      if (navigator.onLine) intentarSubirCola()
    }, 20000)
    function alVolverAlFrente() {
      if (document.visibilityState === 'visible' && navigator.onLine) intentarSubirCola()
    }
    document.addEventListener('visibilitychange', alVolverAlFrente)
    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolverAlFrente)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, tipo])

  const vistas: EntradaVista[] = [...pendientesCola.map(vistaDeCola), ...remotas.map(vistaDeRemota)].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
  )

  return { vistas, cargando, recargar: cargar, reintentarAhora: intentarSubirCola }
}

function EntradaCard({
  entrada,
  onBorrar,
  onCambiarEstado,
  onReintentar,
}: {
  entrada: EntradaVista
  onBorrar: () => void
  onCambiarEstado?: (estado: EstadoObservacion) => void
  onReintentar?: () => void
}) {
  const primeraFotoLocal = entrada.fotosLocales[0]
  const primeraFotoLocalUrl = useBlobUrl(primeraFotoLocal)
  const totalFotos = entrada.fotos.length + entrada.fotosLocales.length

  function borrar() {
    const confirmado = confirm('¿Borrar esta entrada? Esta acción no se puede deshacer.')
    if (!confirmado) return
    onBorrar()
  }

  return (
    <div className="entry-card">
      {entrada.fotosLocales.length > 0 && primeraFotoLocalUrl && (
        <div className="entry-thumb-wrap">
          <img className="entry-thumb" src={primeraFotoLocalUrl} alt="" />
          {totalFotos > 1 && <span className="entry-thumb-badge">+{totalFotos - 1}</span>}
        </div>
      )}
      {entrada.fotosLocales.length === 0 && entrada.fotos[0] && (
        <EntradaThumbRemota ruta={entrada.fotos[0]} extra={totalFotos - 1} />
      )}
      <div className="entry-body">
        <div className="entry-date">{formatFecha(entrada.fecha)}</div>
        {entrada.texto && <div className="entry-note">{entrada.texto}</div>}
        {entrada.autorEmail && (
          <div className="entry-autor">
            <IconUsuario size={12} />
            {entrada.autorEmail}
          </div>
        )}
        {entrada.estado && (
          <select
            className={`estado-select estado-${entrada.estado}`}
            value={entrada.estado}
            disabled={!onCambiarEstado}
            onChange={(e) => onCambiarEstado?.(e.target.value as EstadoObservacion)}
          >
            {ESTADOS_OBSERVACION.map((op) => (
              <option key={op.valor} value={op.valor}>
                {op.etiqueta}
              </option>
            ))}
          </select>
        )}
      </div>
      {entrada.ultimoError ? (
        <button
          type="button"
          className="entry-sync-badge entry-sync-error"
          title={`No se pudo subir: ${entrada.ultimoError}. Toca para reintentar.`}
          aria-label="Error al subir, toca para ver el detalle y reintentar"
          onClick={() => {
            // En el celular los "title" no se ven al tocar (solo con mouse),
            // así que el mensaje real se muestra aquí para poder leerlo.
            alert(`No se pudo subir esta entrada:\n\n${entrada.ultimoError}\n\nSe va a reintentar ahora.`)
            onReintentar?.()
          }}
        >
          <IconAdvertencia size={15} />
        </button>
      ) : (
        <span
          className={`entry-sync-badge ${entrada.pendienteDeSubir ? 'entry-sync-pendiente' : 'entry-sync-listo'}`}
          title={entrada.pendienteDeSubir ? 'Guardado en este celular — se sube solo cuando haya señal' : 'Sincronizado con la nube'}
          aria-label={entrada.pendienteDeSubir ? 'Sin subir todavía' : 'Sincronizado'}
        >
          {entrada.pendienteDeSubir ? <IconSubiendo size={15} /> : '✓✓'}
        </span>
      )}
      <button type="button" className="entry-borrar" onClick={borrar} aria-label="Borrar entrada">
        <IconEliminar size={15} />
      </button>
    </div>
  )
}

/** Una entrada del periodo, ya con su texto editable antes de generar el PDF. */
interface EntradaBorrador {
  id: string
  fecha: string
  fotos: Blob[]
  texto: string
}

/** Una observación abierta (no atendida) al momento de armar el reporte —
 * se muestra tal cual, sin editar, junto con su estatus. */
interface ObservacionBorrador extends EntradaBorrador {
  estado: EstadoObservacion
}

/** Vista previa editable del reporte: el resumen, comentarios, pendientes y
 * el texto de cada entrada se pueden corregir a mano (fotos y fechas no,
 * esas quedan como están) antes de generar el PDF final. Las observaciones
 * sin atender se muestran solas, aparte de las notas — no se editan aquí,
 * su texto y estatus se ajustan desde la pestaña de Observaciones. */
function ReportePreview({
  obraNombre,
  periodoLabel,
  resumenInicial,
  entradasIniciales,
  observacionesAbiertas,
  onCancelar,
  onConfirmar,
}: {
  obraNombre: string
  periodoLabel: string
  resumenInicial: string
  entradasIniciales: EntradaBorrador[]
  observacionesAbiertas: ObservacionBorrador[]
  onCancelar: () => void
  onConfirmar: (datos: {
    resumen: string
    comentarios: string
    comentariosFotos: Blob[]
    pendientes: string
    elaboradoPor: string
    entradas: EntradaBorrador[]
  }) => Promise<void>
}) {
  const [resumen, setResumen] = useState(resumenInicial)
  const [comentarios, setComentarios] = useState('')
  const [comentariosFotos, setComentariosFotos] = useState<Blob[]>([])
  const [pendientes, setPendientes] = useState('')
  const [elaboradoPor, setElaboradoPor] = useState(() => localStorage.getItem('bitacora:elaboradoPor') ?? '')
  const [entradas, setEntradas] = useState(entradasIniciales)
  const [generando, setGenerando] = useState(false)

  function actualizarTexto(id: string, texto: string) {
    setEntradas((prev) => prev.map((e) => (e.id === id ? { ...e, texto } : e)))
  }

  function handleFotosComentarios(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) setComentariosFotos((prev) => [...prev, ...files])
    e.target.value = ''
  }

  function quitarFotoComentario(index: number) {
    setComentariosFotos((prev) => prev.filter((_, i) => i !== index))
  }

  async function confirmar() {
    setGenerando(true)
    try {
      localStorage.setItem('bitacora:elaboradoPor', elaboradoPor.trim())
      await onConfirmar({ resumen, comentarios, comentariosFotos, pendientes, elaboradoPor, entradas })
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="reporte-preview">
      <h2>Vista previa del reporte</h2>
      <p className="field-hint">{obraNombre} — {periodoLabel}</p>

      <div className="field">
        <label htmlFor="reporte-resumen">Resumen del periodo</label>
        <textarea
          id="reporte-resumen"
          rows={6}
          value={resumen}
          onChange={(e) => setResumen(e.target.value)}
          placeholder="Escribe o ajusta el resumen del periodo…"
        />
      </div>

      <div className="reporte-preview-entradas">
        {entradas.length === 0 && (
          <p className="empty-state">No hubo entradas registradas en este periodo.</p>
        )}
        {entradas.map((e) => (
          <div key={e.id} className="reporte-preview-entrada">
            <div className="entry-date">{formatFecha(e.fecha)}</div>
            {e.fotos.length > 0 && (
              <div className="photo-thumbs">
                {e.fotos.map((foto, i) => (
                  <PhotoThumb key={i} blob={foto} />
                ))}
              </div>
            )}
            <textarea
              rows={2}
              value={e.texto}
              onChange={(ev) => actualizarTexto(e.id, ev.target.value)}
              placeholder="Sin nota"
            />
          </div>
        ))}
      </div>

      {observacionesAbiertas.length > 0 && (
        <div className="field">
          <label>Observaciones pendientes (se incluyen automáticamente)</label>
          <div className="reporte-preview-entradas">
            {observacionesAbiertas.map((o) => (
              <div key={o.id} className="reporte-preview-entrada">
                <div className="entry-date">
                  {formatFecha(o.fecha)} · <span className={`estado-badge estado-${o.estado}`}>{etiquetaEstado(o.estado)}</span>
                </div>
                {o.fotos.length > 0 && (
                  <div className="photo-thumbs">
                    {o.fotos.map((foto, i) => (
                      <PhotoThumb key={i} blob={foto} />
                    ))}
                  </div>
                )}
                {o.texto && <p>{o.texto}</p>}
              </div>
            ))}
          </div>
          <p className="field-hint">Las observaciones ya atendidas no aparecen en el reporte.</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="reporte-comentarios">Comentarios generales</label>
        <textarea
          id="reporte-comentarios"
          rows={4}
          value={comentarios}
          onChange={(e) => setComentarios(e.target.value)}
          placeholder="Observaciones generales del periodo (opcional)…"
        />
        {comentariosFotos.length > 0 && (
          <div className="photo-thumbs">
            {comentariosFotos.map((foto, i) => (
              <PhotoThumb key={i} blob={foto} onQuitar={() => quitarFotoComentario(i)} />
            ))}
          </div>
        )}
        <input type="file" accept="image/*" multiple onChange={handleFotosComentarios} />
      </div>

      <div className="field">
        <label htmlFor="reporte-pendientes">Pendientes para la semana siguiente</label>
        <textarea
          id="reporte-pendientes"
          rows={4}
          value={pendientes}
          onChange={(e) => setPendientes(e.target.value)}
          placeholder="¿Qué queda pendiente para la próxima semana? (opcional)…"
        />
      </div>

      <div className="field">
        <label htmlFor="reporte-elaboro">Elaborado por</label>
        <input
          id="reporte-elaboro"
          value={elaboradoPor}
          onChange={(e) => setElaboradoPor(e.target.value)}
          placeholder="Tu nombre"
        />
      </div>

      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancelar} disabled={generando}>
          Cancelar
        </button>
        <button type="button" className="primary" onClick={confirmar} disabled={generando}>
          {generando ? 'Generando PDF…' : 'Generar PDF'}
        </button>
      </div>
    </div>
  )
}

/** Lunes de la semana a la que pertenece `fecha`, en la zona horaria local. */
function inicioDeSemanaDe(fecha: Date): Date {
  const dia = fecha.getDay() // 0 = domingo
  const diasDesdeLunes = (dia + 6) % 7
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - diasDesdeLunes)
}

/** Calcula el rango [inicio, fin) y la etiqueta legible de la semana o mes
 * actual, en la zona horaria local del dispositivo. */
function calcularPeriodo(periodo: 'semana' | 'mes'): { inicio: Date; fin: Date; label: string } {
  const ahora = new Date()
  if (periodo === 'semana') {
    const inicio = inicioDeSemanaDe(ahora)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 7)
    const finInclusive = new Date(fin.getTime() - 1)
    const label = `Semana del ${inicio.toLocaleDateString('es', { day: '2-digit', month: 'long' })} al ${finInclusive.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}`
    return { inicio, fin, label }
  }
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1)
  const mesTexto = inicio.toLocaleDateString('es', { month: 'long', year: 'numeric' })
  const label = mesTexto.charAt(0).toUpperCase() + mesTexto.slice(1)
  return { inicio, fin, label }
}

/** Clave estable de la semana a la que pertenece una fecha: "YYYY-MM-DD"
 * del lunes de esa semana, en hora local (no UTC, para no correr la fecha
 * de quienes están lejos de UTC). Con esto las notas/observaciones de una
 * obra quedan agrupadas solas en "carpetas" de semana, sin tener que crear
 * nada a mano — la carpeta "existe" en cuanto hay una entrada esa semana. */
function claveSemana(fechaIso: string): string {
  const inicio = inicioDeSemanaDe(new Date(fechaIso))
  const yyyy = inicio.getFullYear()
  const mm = String(inicio.getMonth() + 1).padStart(2, '0')
  const dd = String(inicio.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatCorto(d: Date): string {
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Nombre por defecto de una carpeta de semana, antes de que alguien la
 * renombre: el rango de fechas en formato dd/mm/aa. */
function etiquetaSemanaPorDefecto(clave: string): string {
  const [y, m, d] = clave.split('-').map(Number)
  const inicio = new Date(y, m - 1, d)
  const fin = new Date(inicio)
  fin.setDate(fin.getDate() + 6)
  return `${formatCorto(inicio)} – ${formatCorto(fin)}`
}

interface CarpetaSemana {
  clave: string
  entradas: EntradaVista[]
}

/** Agrupa las notas/observaciones por semana, más reciente primero. */
function agruparPorSemana(vistas: EntradaVista[]): CarpetaSemana[] {
  const mapa = new Map<string, EntradaVista[]>()
  for (const v of vistas) {
    const clave = claveSemana(v.fecha)
    const lista = mapa.get(clave)
    if (lista) lista.push(v)
    else mapa.set(clave, [v])
  }
  return [...mapa.entries()]
    .map(([clave, entradas]) => ({ clave, entradas }))
    .sort((a, b) => b.clave.localeCompare(a.clave))
}

/** Muestra las notas/observaciones de una obra agrupadas en carpetas por
 * semana: aparecen solas (no hay que "crear" nada) y se pueden renombrar —
 * si no se renombran, el nombre es el rango de fechas de esa semana. */
function ListaPorSemanas({
  obraId,
  tipo,
  lista,
  onBorrar,
  onCambiarEstado,
  onReintentar,
}: {
  obraId: string
  tipo: TipoEntrada
  lista: { vistas: EntradaVista[]; cargando: boolean }
  onBorrar: (entrada: EntradaVista) => void
  onCambiarEstado?: (entrada: EntradaVista, estado: EstadoObservacion) => void
  onReintentar: () => void
}) {
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [semanaAbierta, setSemanaAbierta] = useState<string | null>(null)

  useEffect(() => {
    setSemanaAbierta(null)
    listarNombresSemana(obraId, tipo)
      .then(setNombres)
      .catch((err) => console.error('No se pudieron cargar los nombres de las semanas:', err))
  }, [obraId, tipo])

  async function renombrar(clave: string) {
    const actual = nombres[clave] ?? etiquetaSemanaPorDefecto(clave)
    const nuevo = prompt('Nombre de la semana:', actual)
    if (!nuevo || !nuevo.trim() || nuevo.trim() === actual) return
    try {
      await renombrarSemana(obraId, tipo, clave, nuevo.trim())
      setNombres((prev) => ({ ...prev, [clave]: nuevo.trim() }))
    } catch (err) {
      alert(`No se pudo renombrar la semana: ${mensajeDeError(err)}`)
    }
  }

  const carpetas = agruparPorSemana(lista.vistas)

  if (!lista.cargando && carpetas.length === 0) {
    return (
      <p className="empty-state">
        {tipo === 'nota'
          ? 'Todavía no hay notas en esta obra. Agrega la primera foto o nota.'
          : 'Todavía no hay observaciones en esta obra.'}
      </p>
    )
  }

  if (semanaAbierta === null) {
    return (
      <div className="carpetas-lista">
        {carpetas.map((c) => (
          <div key={c.clave} className="carpeta-semana">
            <button type="button" className="carpeta-semana-abrir" onClick={() => setSemanaAbierta(c.clave)}>
              <span className="carpeta-semana-icono">
                <IconCarpeta size={19} />
              </span>
              <span className="carpeta-semana-nombre">{nombres[c.clave] ?? etiquetaSemanaPorDefecto(c.clave)}</span>
              <span className="carpeta-semana-cantidad">{c.entradas.length}</span>
            </button>
            <button
              type="button"
              className="carpeta-semana-editar"
              onClick={() => renombrar(c.clave)}
              aria-label="Renombrar semana"
            >
              <IconEditar size={14} />
            </button>
          </div>
        ))}
      </div>
    )
  }

  const carpetaActual = carpetas.find((c) => c.clave === semanaAbierta)
  return (
    <div>
      <button type="button" className="volver-carpetas" onClick={() => setSemanaAbierta(null)}>
        <IconFlechaIzquierda size={15} />
        {nombres[semanaAbierta] ?? etiquetaSemanaPorDefecto(semanaAbierta)}
      </button>
      <div className="entry-list">
        {carpetaActual?.entradas.map((e) => (
          <EntradaCard
            key={e.claveLocal}
            entrada={e}
            onBorrar={() => onBorrar(e)}
            onCambiarEstado={onCambiarEstado ? (estado) => onCambiarEstado(e, estado) : undefined}
            onReintentar={onReintentar}
          />
        ))}
      </div>
    </div>
  )
}

/** Junta lo que ya está en Supabase con lo que este dispositivo todavía
 * tiene pendiente de subir, bajando las fotos necesarias para el PDF. Se
 * usa tanto para las notas del periodo como para las observaciones
 * abiertas (que no se filtran por fecha, son pendientes vivos). */
async function construirEntradasBorrador(
  obraId: string,
  tipo: TipoEntrada,
  filtro: (fecha: Date, estado: EstadoObservacion | null) => boolean,
): Promise<(EntradaBorrador & { estado: EstadoObservacion | null })[]> {
  const remotas = await listarEntradas(obraId, tipo).catch((err) => {
    console.error('No se pudieron leer las entradas para el reporte, se usan solo las pendientes locales:', err)
    return [] as EntradaRemota[]
  })
  const cola = await db.entradasCola.where({ obraId, tipo }).toArray()

  const deRemotas = await Promise.all(
    remotas
      .filter((e) => filtro(new Date(e.fecha), e.estado))
      .map(async (e) => ({
        id: e.id,
        fecha: e.fecha,
        texto: e.texto?.trim() ?? '',
        estado: e.estado,
        fotos: (await Promise.all(e.fotos.map((ruta) => descargarFotoEntrada(ruta)))).filter(
          (b): b is Blob => b !== null,
        ),
      })),
  )

  const deCola = cola
    .filter((e) => filtro(new Date(e.fecha), e.estado ?? null))
    .map((e) => ({
      id: `local-${e.id}`,
      fecha: e.fecha,
      texto: e.texto?.trim() ?? '',
      estado: e.estado ?? null,
      fotos: almacenadasABlobs(e.fotos),
    }))

  return [...deRemotas, ...deCola].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
}

function AppAutenticada({ session }: { session: Session }) {
  const online = useOnlineStatus()
  const [vista, setVista] = useState<'inicio' | 'obra-menu' | 'diario'>('inicio')
  const [obraActivaId, setObraActivaId] = useState<string | null>(null)
  const [obraActiva, setObraActiva] = useState<Obra | null>(null)
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [cargandoObras, setCargandoObras] = useState(true)
  const [pestana, setPestana] = useState<TipoEntrada>('nota')
  const [formAbierto, setFormAbierto] = useState(false)
  const [generandoReporte, setGenerandoReporte] = useState<'semana' | 'mes' | null>(null)
  const [reportePendiente, setReportePendiente] = useState<{
    periodoLabel: string
    resumen: string
    entradas: EntradaBorrador[]
    observaciones: ObservacionBorrador[]
  } | null>(null)

  async function cargarObras() {
    setCargandoObras(true)
    try {
      const lista = await listarObras()
      setObras(lista)
    } catch (err) {
      console.error('Error cargando obras:', err)
    } finally {
      setCargandoObras(false)
    }
  }

  useEffect(() => {
    cargarObras()
  }, [])

  const notas = useEntradasObra(obraActivaId, 'nota', online)
  const observaciones = useEntradasObra(obraActivaId, 'observacion', online)
  const listaActiva = pestana === 'nota' ? notas : observaciones

  function entrarAObra(id: string) {
    setObraActivaId(id)
    setObraActiva(obras?.find((o) => o.id === id) ?? null)
    setVista('obra-menu')
    setPestana('nota')
    setFormAbierto(false)
    setReportePendiente(null)
  }

  function abrirDiario() {
    setVista('diario')
    setFormAbierto(false)
    setReportePendiente(null)
  }

  function volverAMenuObra() {
    setVista('obra-menu')
    setFormAbierto(false)
    setReportePendiente(null)
  }

  function volverAInicio() {
    setVista('inicio')
    setFormAbierto(false)
    setReportePendiente(null)
  }

  async function borrarEntrada(entrada: EntradaVista) {
    if (entrada.colaId !== undefined) {
      await db.entradasCola.delete(entrada.colaId)
      return
    }
    if (entrada.remotaId) {
      await eliminarEntrada(entrada.remotaId)
      await (entrada.tipo === 'nota' ? notas.recargar() : observaciones.recargar())
    }
  }

  async function cambiarEstadoObservacion(entrada: EntradaVista, estado: EstadoObservacion) {
    if (entrada.colaId !== undefined) {
      await db.entradasCola.update(entrada.colaId, { estado })
      return
    }
    if (entrada.remotaId) {
      await actualizarEstadoObservacion(entrada.remotaId, estado)
      await observaciones.recargar()
    }
  }

  /** Junta las entradas del periodo, las observaciones todavía abiertas y
   * pide el resumen de IA — arma el borrador que se muestra en la vista
   * previa editable, sin generar el PDF todavía. */
  async function prepararReporte(periodo: 'semana' | 'mes') {
    if (!obraActiva || obraActivaId === null) return
    setGenerandoReporte(periodo)
    try {
      const { inicio, fin, label } = calcularPeriodo(periodo)

      // Nota: las notas de voz se dictan directo con el micrófono del
      // teclado del celular sobre el campo de texto, así que el texto ya
      // viene completo — no hace falta transcribir nada aparte.
      const entradasBorrador = await construirEntradasBorrador(obraActivaId, 'nota', (f) => f >= inicio && f < fin)

      // Las observaciones no se filtran por periodo: son pendientes vivos,
      // aparecen mientras no estén "atendidas" sin importar cuándo se
      // crearon.
      const observacionesBorrador = (
        await construirEntradasBorrador(obraActivaId, 'observacion', (_f, estado) => estado !== 'atendido')
      ).map((o) => ({ ...o, estado: o.estado ?? 'por_atender' }))

      const resumenIA = online
        ? await obtenerResumenIA(
            obraActiva.nombre,
            label,
            entradasBorrador.map((e) => ({ fecha: e.fecha, nota: e.texto })),
          )
        : null

      setReportePendiente({
        periodoLabel: label,
        resumen: resumenIA ?? '',
        entradas: entradasBorrador,
        observaciones: observacionesBorrador,
      })
    } catch (err) {
      console.error(err)
      alert('No se pudo preparar el reporte. Intenta de nuevo.')
    } finally {
      setGenerandoReporte(null)
    }
  }

  /** Genera y descarga el PDF final con el resumen, comentarios,
   * pendientes y los textos ya editados por el usuario en la vista previa. */
  async function confirmarReporte(datos: {
    resumen: string
    comentarios: string
    comentariosFotos: Blob[]
    pendientes: string
    elaboradoPor: string
    entradas: EntradaBorrador[]
  }) {
    if (!obraActiva) return
    try {
      const entradasReporte: EntradaReporte[] = datos.entradas.map((e) => ({
        fecha: e.fecha,
        texto: e.texto,
        fotos: e.fotos,
      }))
      const observacionesReporte: ObservacionReporte[] = (reportePendiente?.observaciones ?? []).map((o) => ({
        fecha: o.fecha,
        texto: o.texto,
        estado: o.estado,
        fotos: o.fotos,
      }))

      // Carga diferida: jsPDF (y su dependencia html2canvas) solo se
      // descargan cuando de verdad se confirma un reporte, para no inflar
      // la carga inicial de la app en obra con mala señal.
      const { generarPdfReporte, descargarBlob } = await import('./pdf')
      const pdfBlob = await generarPdfReporte({
        obraNombre: obraActiva.nombre,
        entradas: entradasReporte,
        periodoLabel: reportePendiente?.periodoLabel ?? '',
        resumen: datos.resumen,
        comentarios: datos.comentarios,
        comentariosFotos: datos.comentariosFotos,
        observacionesAbiertas: observacionesReporte,
        pendientes: datos.pendientes,
        elaboradoPor: datos.elaboradoPor,
        empresaNombre: obraActiva.empresa,
        empresaDatos: obraActiva.empresaDatos,
        empresaLogoUrl: obraActiva.logoUrl,
      })

      const nombreObraArchivo = obraActiva.nombre.trim().toLowerCase().replace(/\s+/g, '-')
      descargarBlob(pdfBlob, `bitacora-${nombreObraArchivo}.pdf`)
      setReportePendiente(null)
    } catch (err) {
      console.error(err)
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    }
  }

  return (
    <>
      <header className="app-header">
        {vista !== 'inicio' && (
          <button
            type="button"
            className="back-btn"
            onClick={vista === 'diario' ? volverAMenuObra : volverAInicio}
            aria-label={vista === 'diario' ? 'Volver al menú de la obra' : 'Volver a mis obras'}
          >
            ←
          </button>
        )}
        <h1>{vista !== 'inicio' && obraActiva ? obraActiva.nombre : 'Bitácora de Obra'}</h1>
        <span className={`online-badge ${online ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          {online ? 'En línea' : 'Sin conexión'}
        </span>
        {vista === 'inicio' && (
          <button
            type="button"
            className="header-signout"
            onClick={() => supabase.auth.signOut()}
            aria-label="Cerrar sesión"
            title={session.user.email ?? 'Cerrar sesión'}
          >
            <IconSalir size={17} />
          </button>
        )}
      </header>

      {vista === 'inicio' && (
        <HomeScreen
          obras={obras}
          cargando={cargandoObras}
          userId={session.user.id}
          onEntrarObra={entrarAObra}
          onCambiaronObras={cargarObras}
        />
      )}

      {vista === 'obra-menu' && obraActiva && <ObraMenu obra={obraActiva} onAbrirDiario={abrirDiario} />}

      {vista === 'diario' && obraActivaId !== null && (
        <main className="app-main">
          {reportePendiente ? (
            <ReportePreview
              obraNombre={obraActiva?.nombre ?? ''}
              periodoLabel={reportePendiente.periodoLabel}
              resumenInicial={reportePendiente.resumen}
              entradasIniciales={reportePendiente.entradas}
              observacionesAbiertas={reportePendiente.observaciones}
              onCancelar={() => setReportePendiente(null)}
              onConfirmar={confirmarReporte}
            />
          ) : (
            <>
              {!formAbierto && (
                <>
                  <div className="tabs">
                    <button
                      type="button"
                      className={`tab ${pestana === 'nota' ? 'tab-activa' : ''}`}
                      onClick={() => setPestana('nota')}
                    >
                      Notas
                    </button>
                    <button
                      type="button"
                      className={`tab ${pestana === 'observacion' ? 'tab-activa' : ''}`}
                      onClick={() => setPestana('observacion')}
                    >
                      Observaciones
                    </button>
                  </div>

                  <button className="primary new-entry-btn" onClick={() => setFormAbierto(true)}>
                    <IconMas size={16} />
                    {pestana === 'nota' ? 'Nueva nota' : 'Nueva observación'}
                  </button>

                  {pestana === 'nota' && (
                    <div className="reportes-bar">
                      <button
                        type="button"
                        className="secondary"
                        disabled={generandoReporte !== null}
                        onClick={() => prepararReporte('semana')}
                      >
                        <IconDocumento size={15} />
                        {generandoReporte === 'semana' ? 'Preparando…' : 'Reporte semanal'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={generandoReporte !== null}
                        onClick={() => prepararReporte('mes')}
                      >
                        <IconDocumento size={15} />
                        {generandoReporte === 'mes' ? 'Preparando…' : 'Reporte mensual'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {formAbierto && (
                <EntradaForm
                  obraId={obraActivaId}
                  tipo={pestana}
                  onGuardado={() => (pestana === 'nota' ? notas.recargar() : observaciones.recargar())}
                  onClose={() => setFormAbierto(false)}
                />
              )}

              <ListaPorSemanas
                obraId={obraActivaId}
                tipo={pestana}
                lista={listaActiva}
                onBorrar={borrarEntrada}
                onCambiarEstado={pestana === 'observacion' ? cambiarEstadoObservacion : undefined}
                onReintentar={() => listaActiva.reintentarAhora()}
              />
            </>
          )}
        </main>
      )}
    </>
  )
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      setSession(nuevaSesion)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <main className="app-main">
        <p className="empty-state">Cargando…</p>
      </main>
    )
  }

  if (session === null) {
    return <AuthScreen />
  }

  return <AppAutenticada session={session} />
}

export default App
