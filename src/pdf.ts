import jsPDF from 'jspdf'

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('No se pudo leer la imagen'))
    el.src = url
  })
}

/** Descarga una imagen remota (p.ej. el logo de la empresa, guardado como
 * URL de Supabase Storage) y la devuelve como Blob para poder procesarla
 * igual que las fotos locales. */
async function cargarBlobDesdeUrl(url: string): Promise<Blob | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    return await resp.blob()
  } catch {
    return null // sin conexión, url vencida, etc. — se omite sin romper el PDF
  }
}

/**
 * Recorta y redimensiona una foto (cualquier formato/orientación) para que
 * llene exactamente un recuadro de `targetWpt` x `targetHpt` puntos —
 * equivalente a `object-fit: cover`. Así todas las fotos del PDF ocupan el
 * mismo espacio visual, sin importar si la original era vertical, horizontal
 * o de otra proporción.
 */
async function prepararImagenParaPdf(
  blob: Blob,
  targetWpt: number,
  targetHpt: number,
): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await cargarImagen(url)
    const targetAspect = targetWpt / targetHpt
    const srcAspect = img.naturalWidth / img.naturalHeight

    let sx = 0
    let sy = 0
    let sw = img.naturalWidth
    let sh = img.naturalHeight
    if (srcAspect > targetAspect) {
      // La foto es más ancha que el recuadro: se recortan los costados.
      sw = img.naturalHeight * targetAspect
      sx = (img.naturalWidth - sw) / 2
    } else {
      // La foto es más alta que el recuadro: se recorta arriba/abajo.
      sh = img.naturalWidth / targetAspect
      sy = (img.naturalHeight - sh) / 2
    }

    const RESOLUCION = 2 // px por pt, para que no se vea pixelada al imprimir
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(targetWpt * RESOLUCION))
    canvas.height = Math.max(1, Math.round(targetHpt * RESOLUCION))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return null // foto corrupta/formato no soportado por el navegador: se omite
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Ajusta un logo dentro de un recuadro de `maxWpt` x `maxHpt` puntos SIN
 * recortarlo (a diferencia de las fotos, un logo no se debe cortar) —
 * equivalente a `object-fit: contain`. Devuelve también el ancho/alto final
 * ya escalados para poder centrarlo.
 */
async function prepararLogoParaPdf(
  blob: Blob,
  maxWpt: number,
  maxHpt: number,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await cargarImagen(url)
    const escala = Math.min(maxWpt / img.naturalWidth, maxHpt / img.naturalHeight, 1)
    const width = Math.max(1, Math.round(img.naturalWidth * escala))
    const height = Math.max(1, Math.round(img.naturalHeight * escala))

    const RESOLUCION = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * RESOLUCION
    canvas.height = height * RESOLUCION
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function formatFechaLarga(iso: string) {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Una entrada ya lista para el PDF: texto final (nota + transcripción de
 * audio, ya editado por el usuario en la vista previa) y sus fotos. */
export interface EntradaReporte {
  fecha: string
  texto?: string
  fotos: Blob[]
}

/** Una observación todavía sin cerrar (no "atendida"), que se agrega sola
 * a la sección de pendientes del reporte — las ya atendidas no aparecen. */
export interface ObservacionReporte {
  fecha: string
  texto?: string
  estado: 'por_atender' | 'en_proceso' | 'atendido'
  fotos: Blob[]
}

const ETIQUETA_ESTADO_OBSERVACION: Record<string, string> = {
  por_atender: 'Por atender',
  en_proceso: 'En proceso',
}

export interface OpcionesReporte {
  obraNombre: string
  /** Ya filtradas al periodo deseado y ordenadas por fecha ascendente. */
  entradas: EntradaReporte[]
  periodoLabel: string
  /** Resumen narrativo (de IA o editado a mano); si viene vacío, se omite
   * esa sección sin romper el resto del PDF. */
  resumen?: string
  /** Comentarios generales del periodo, escritos a mano; opcional. */
  comentarios?: string
  /** Fotos adjuntas a los comentarios generales; opcional. */
  comentariosFotos?: Blob[]
  /** Observaciones abiertas (por atender o en proceso) al momento de
   * generar el reporte, sin importar el periodo — son pendientes vivos. */
  observacionesAbiertas?: ObservacionReporte[]
  /** Pendientes para la semana siguiente, escritos a mano; opcional. */
  pendientes?: string
  /** Nombre de quién elaboró el reporte; opcional. */
  elaboradoPor?: string
  /** Nombre de la empresa dueña de la obra; opcional. */
  empresaNombre?: string | null
  /** Datos de contacto de la empresa (dirección, teléfono, etc.), en texto
   * libre; opcional. */
  empresaDatos?: string | null
  /** URL del logo de la empresa (Supabase Storage); opcional. */
  empresaLogoUrl?: string | null
}

export async function generarPdfReporte({
  obraNombre,
  entradas,
  periodoLabel,
  resumen,
  comentarios,
  comentariosFotos,
  observacionesAbiertas,
  pendientes,
  elaboradoPor,
  empresaNombre,
  empresaDatos,
  empresaLogoUrl,
}: OpcionesReporte): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - margin * 2
  let y = margin

  function saltoDePaginaSiHaceFalta(alturaNecesaria: number) {
    if (y + alturaNecesaria > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  /** Escribe un bloque con título en negrita + párrafo normal debajo,
   * respetando saltos de página línea por línea. Se usa para el resumen,
   * los comentarios generales y los pendientes de la semana siguiente. */
  function escribirBloqueTexto(titulo: string, texto: string) {
    saltoDePaginaSiHaceFalta(50)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(titulo, margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    const lineas = doc.splitTextToSize(texto.trim(), contentW)
    for (const linea of lineas) {
      saltoDePaginaSiHaceFalta(14)
      doc.text(linea, margin, y)
      y += 14
    }
    y += 14
  }

  // Recuadro fijo para todas las fotos del reporte (relación 4:3), para que
  // ninguna se vea más grande que otra sin importar su orientación original.
  const FOTO_GAP = 10

  function medidasFoto(anchoDisponible: number, cols: number) {
    const fotoAncho = (anchoDisponible - FOTO_GAP * (cols - 1)) / cols
    return { fotoAncho, fotoAlto: fotoAncho * 0.75 }
  }

  function alturaGridFotos(cantidad: number, anchoDisponible: number, cols: number): number {
    if (cantidad === 0) return 0
    const { fotoAlto } = medidasFoto(anchoDisponible, cols)
    const filas = Math.ceil(cantidad / cols)
    return 6 + filas * (fotoAlto + FOTO_GAP)
  }

  /** Dibuja una grilla de fotos a tamaño uniforme dentro del ancho y la
   * posición `x` que se le indiquen — así sirve tanto para una sección a
   * todo lo ancho (comentarios generales) como para una sola columna
   * (entradas). El chequeo de salto de página/columna se hace por FILA
   * completa, nunca a media foto, usando la función `salto` que se pase. */
  async function dibujarGridFotos(
    fotos: Blob[],
    x: number,
    anchoDisponible: number,
    cols: number,
    salto: (alturaNecesaria: number) => void,
  ) {
    if (fotos.length === 0) return
    const { fotoAncho, fotoAlto } = medidasFoto(anchoDisponible, cols)
    y += 6
    for (let i = 0; i < fotos.length; i += cols) {
      salto(fotoAlto + FOTO_GAP)
      const filaFotos = fotos.slice(i, i + cols)
      for (let c = 0; c < filaFotos.length; c++) {
        const dataUrl = await prepararImagenParaPdf(filaFotos[c], fotoAncho, fotoAlto)
        if (!dataUrl) continue
        const xFoto = x + c * (fotoAncho + FOTO_GAP)
        doc.addImage(dataUrl, 'JPEG', xFoto, y, fotoAncho, fotoAlto)
      }
      y += fotoAlto + FOTO_GAP
    }
  }

  /** Dibuja una entrada (nota u observación) como un solo bloque: primero
   * la(s) foto(s), luego el día como subtítulo chico justo debajo (para que
   * quede claro que ese pie corresponde a esas fotos) y hasta abajo el
   * comentario — así se lee como "foto → cuándo → qué se comenta de ella"
   * en vez de una fecha y un texto sueltos arriba de una fila de fotos.
   *
   * Antes de dibujar nada se calcula la altura completa del bloque y se
   * pide el salto de columna/página de una sola vez — así una foto nunca
   * queda en una hoja y su comentario en la siguiente: el bloque entero se
   * mueve junto a donde sí quepa. `obtenerX` se evalúa DESPUÉS de decidir
   * si hubo salto de columna, para dibujar del lado correcto. */
  async function escribirBloqueEntrada(
    fechaTexto: string,
    texto: string | undefined | null,
    fotos: Blob[],
    obtenerX: () => number,
    anchoDisponible: number,
    cols: number,
    salto: (alturaNecesaria: number) => void,
  ) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    const lineasTexto = texto?.trim() ? doc.splitTextToSize(texto.trim(), anchoDisponible) : []
    // +14 de colchón para la rayita divisoria que va justo después del
    // bloque, así nunca queda pegada al borde inferior de la columna.
    const alturaBloque = alturaGridFotos(fotos.length, anchoDisponible, cols) + 13 + lineasTexto.length * 14 + 14

    salto(alturaBloque)
    const x = obtenerX()
    const paginaInicio = doc.getNumberOfPages()
    const yInicio = y

    await dibujarGridFotos(fotos, x, anchoDisponible, cols, salto)

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(120)
    doc.text(fechaTexto, x, y)
    doc.setTextColor(0)
    y += 13

    if (lineasTexto.length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10.5)
      for (const linea of lineasTexto) {
        doc.text(linea, x, y)
        y += 14
      }
    }

    // Una rayita naranja a la izquierda de TODAS las entradas (con o sin
    // foto) para marcar dónde empieza cada una. Si el bloque se alcanzó a
    // partir entre dos páginas (muy largo) ya no hay un solo tramo vertical
    // que dibujar, así que se omite solo en ese caso raro.
    if (doc.getNumberOfPages() === paginaInicio) {
      doc.setDrawColor(230, 126, 34)
      doc.setLineWidth(2)
      doc.line(x - 10, yInicio - 2, x - 10, y - 2)
      doc.setLineWidth(0.2)
      doc.setDrawColor(0)
    }

    y += 8
    doc.setDrawColor(235)
    doc.line(x, y - 6, x + anchoDisponible, y - 6)
    y += 6
  }

  // --- Encabezado / portada ---
  // El logo de la empresa (si hay) va arriba a la derecha; el texto del
  // encabezado se limita a lo que quede a la izquierda para no encimarse.
  let anchoTextoEncabezado = contentW
  if (empresaLogoUrl) {
    const logoBlob = await cargarBlobDesdeUrl(empresaLogoUrl)
    if (logoBlob) {
      const LOGO_MAX = 64
      const logo = await prepararLogoParaPdf(logoBlob, LOGO_MAX, LOGO_MAX)
      if (logo) {
        doc.addImage(logo.dataUrl, 'PNG', pageW - margin - logo.width, y, logo.width, logo.height)
        anchoTextoEncabezado = contentW - logo.width - 16
      }
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Bitácora de Obra', margin, y)
  y += 26
  doc.setFontSize(15)
  doc.text(obraNombre, margin, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(110)
  if (empresaNombre?.trim()) {
    doc.text(empresaNombre.trim(), margin, y)
    y += 15
  }
  if (empresaDatos?.trim()) {
    doc.setFontSize(9.5)
    const lineasEmpresa = empresaDatos
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => doc.splitTextToSize(l, anchoTextoEncabezado))
    for (const linea of lineasEmpresa) {
      doc.text(linea, margin, y)
      y += 12
    }
    doc.setFontSize(11)
    y += 3
  }
  doc.text(periodoLabel, margin, y)
  y += 15
  const generadoEl = new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
  doc.text(`Generado el ${generadoEl}`, margin, y)
  y += 15
  if (elaboradoPor?.trim()) {
    doc.text(`Elaborado por: ${elaboradoPor.trim()}`, margin, y)
    y += 15
  }
  doc.setTextColor(0)
  void anchoTextoEncabezado // el texto del encabezado es corto por diseño; se deja el ancho calculado por si crece.
  y += 12

  // --- Resumen narrativo y comentarios generales ---
  if (resumen && resumen.trim()) {
    escribirBloqueTexto('Resumen del periodo', resumen)
  }
  if ((comentarios && comentarios.trim()) || (comentariosFotos && comentariosFotos.length > 0)) {
    escribirBloqueTexto('Comentarios generales', comentarios?.trim() || '(sin texto, ver fotos adjuntas)')
    if (comentariosFotos && comentariosFotos.length > 0) {
      await dibujarGridFotos(comentariosFotos, margin, contentW, 2, saltoDePaginaSiHaceFalta)
      y += 8
    }
  }

  /** Arma el estado de un listado de entradas en dos columnas (para no
   * dejar tanto espacio en blanco cuando una entrada es corta): se llena la
   * columna izquierda de arriba hacia abajo, luego la derecha, y solo hasta
   * que ninguna de las dos tiene espacio se pasa a una hoja nueva. */
  function crearColumnas() {
    const COL_GAP = 24
    const colW = (contentW - COL_GAP) / 2
    const colX: [number, number] = [margin, margin + colW + COL_GAP]
    let columna: 0 | 1 = 0
    let yColStart = y
    function salto(alturaNecesaria: number) {
      if (y + alturaNecesaria <= pageH - margin) return
      if (columna === 0) {
        columna = 1
        y = yColStart
      } else {
        doc.addPage()
        columna = 0
        y = margin
        yColStart = margin
      }
    }
    return { colW, salto, obtenerX: () => colX[columna] }
  }

  saltoDePaginaSiHaceFalta(20)
  doc.setDrawColor(220)
  doc.line(margin, y, pageW - margin, y)
  y += 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Detalle de entradas', margin, y)
  y += 18

  if (entradas.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.text('No hubo entradas registradas en este periodo.', margin, y)
    y += 20
  } else {
    const { colW, salto, obtenerX } = crearColumnas()
    for (const entrada of entradas) {
      await escribirBloqueEntrada(formatFechaLarga(entrada.fecha), entrada.texto, entrada.fotos, obtenerX, colW, 1, salto)
    }
  }

  // --- Observaciones todavía sin atender (viven aparte de las notas; las
  // ya atendidas ni se mencionan aquí). Van en su propia hoja, con un
  // subtítulo más grande para que se distingan claramente de las notas. ---
  const observacionesSinAtender = (observacionesAbiertas ?? []).filter(
    (o) => o.estado === 'por_atender' || o.estado === 'en_proceso',
  )
  if (observacionesSinAtender.length > 0) {
    doc.addPage()
    y = margin
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('Observaciones pendientes', margin, y)
    y += 26

    const { colW, salto, obtenerX } = crearColumnas()
    for (const obs of observacionesSinAtender) {
      const etiqueta = ETIQUETA_ESTADO_OBSERVACION[obs.estado] ?? obs.estado
      await escribirBloqueEntrada(`${formatFechaLarga(obs.fecha)} — ${etiqueta}`, obs.texto, obs.fotos, obtenerX, colW, 1, salto)
    }
  }

  // --- Pendientes para la semana siguiente (cierre del reporte) ---
  if (pendientes && pendientes.trim()) {
    y += 8
    saltoDePaginaSiHaceFalta(20)
    doc.setDrawColor(220)
    doc.line(margin, y, pageW - margin, y)
    y += 22
    escribirBloqueTexto('Pendientes para la semana siguiente', pendientes)
  }

  return doc.output('blob')
}

export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
