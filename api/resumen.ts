import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Función serverless (Vercel): redacta el resumen narrativo semanal/mensual
 * a partir de las notas sueltas de una obra.
 *
 * La API key de Anthropic vive SOLO aquí, como variable de entorno del
 * proyecto en Vercel — nunca se manda al navegador. Si todavía no está
 * configurada, se responde con `resumen: null` en vez de un error: así el
 * PDF se sigue generando (sin esa sección) mientras se termina de
 * configurar la cuenta de Anthropic.
 */

interface EntradaResumen {
  fecha: string
  nota?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  const { obraNombre, periodoLabel, entradas } = (req.body ?? {}) as {
    obraNombre?: string
    periodoLabel?: string
    entradas?: EntradaResumen[]
  }

  if (!Array.isArray(entradas) || entradas.length === 0) {
    res.status(400).json({ error: 'No hay entradas para resumir' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(200).json({ resumen: null })
    return
  }

  const notas = entradas
    .map((e) => {
      const fechaLegible = new Date(e.fecha).toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
      return `- ${fechaLegible}: ${e.nota?.trim() || '(sin nota escrita, solo evidencia fotográfica)'}`
    })
    .join('\n')

  const prompt = `Eres un asistente que ayuda a redactar bitácoras de obra de construcción.
A continuación tienes las notas sueltas registradas día a día en la obra "${obraNombre ?? 'sin nombre'}" durante ${periodoLabel ?? 'el periodo seleccionado'}.

Notas:
${notas}

Escribe un resumen narrativo, profesional y coherente en español (entre 3 y 6 oraciones) que sintetice el avance GENERAL del periodo completo, como lo redactaría un residente de obra en su reporte. Es muy importante que NO sea un recuento día por día (evita frases como "el día X se hizo Y, el día Z se hizo W" repetidas una tras otra) — en vez de eso, agrupa la información por tema o actividad (por ejemplo: avance en cimentación, instalaciones, acabados, incidencias) y preséntala como un solo relato integrado de lo logrado en todo el periodo. No inventes información que no esté en las notas. Si notas huecos o contradicciones evidentes entre entradas, señálalas brevemente al final en una oración aparte que empiece con "Nota:". Escribe en párrafos, sin viñetas, sin encabezados y sin ningún formato Markdown (nada de asteriscos, numerales ni subrayados) — el resultado se inserta como texto plano en un PDF, así que debe ser prosa simple de principio a fin.`

  try {
    const client = new Anthropic({ apiKey })
    const respuesta = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const bloqueTexto = respuesta.content.find((b) => b.type === 'text')
    res.status(200).json({ resumen: bloqueTexto?.type === 'text' ? bloqueTexto.text : null })
  } catch (err) {
    console.error('Error generando resumen con Claude:', err)
    // No se rompe el flujo del PDF por un error del lado de la IA.
    res.status(200).json({ resumen: null })
  }
}
