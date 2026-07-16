import { privateHeaders, requireEditor, requireSameOriginJson } from "../../../../editor-auth";

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

type Context = { params: Promise<{ id: string }> };
type Payload = Record<string, string | number | boolean | string[]>;

export async function GET(request: Request, context: Context) {
  try {
    const denied=await requireEditor(request);
    if(denied)return denied;
    const { id } = await context.params;
    const db = await database();
    const row = await db.prepare("SELECT payload, completion, updated_at AS updatedAt FROM event_interviews WHERE event_id = ?").bind(Number(id)).first<{ payload: string; completion: number; updatedAt: string }>();
    return Response.json({ interview: row ? { ...row, payload: JSON.parse(row.payload || "{}") } : { payload: {}, completion: 0, updatedAt: null } },{headers:privateHeaders});
  } catch {
    return Response.json({ error: "No se pudo cargar la entrevista" }, { status: 500,headers:privateHeaders });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const denied=await requireEditor(request);
    if(denied)return denied;
    const invalid=requireSameOriginJson(request);
    if(invalid)return invalid;
    const { id } = await context.params;
    const eventId = Number(id);
    const body = (await request.json()) as { payload?: Payload; completion?: number };
    const payload = body.payload ?? {};
    const completion = Math.max(0, Math.min(100, Number(body.completion ?? 0)));
    const db = await database();
    await db.prepare("INSERT INTO event_interviews (event_id, payload, completion, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(event_id) DO UPDATE SET payload = excluded.payload, completion = excluded.completion, updated_at = CURRENT_TIMESTAMP").bind(eventId, JSON.stringify(payload), completion).run();

    const current = await db.prepare("SELECT e.client_id AS clientId, e.venue_id AS venueId FROM events e WHERE e.id = ?").bind(eventId).first<{ clientId: number; venueId: number }>();
    if (!current) return Response.json({ error: "Evento no encontrado" }, { status: 404 });

    const clientName = String(payload.cliente ?? "").trim();
    if (clientName) await db.prepare("UPDATE clients SET name = ?, phone = ?, email = ? WHERE id = ?").bind(clientName, String(payload.telefono ?? ""), String(payload.correo ?? ""), current.clientId).run();
    const venueName = String(payload.local ?? "").trim();
    if (venueName) {
      let venue = await db.prepare("SELECT id FROM venues WHERE name = ? LIMIT 1").bind(venueName).first<{ id: number }>();
      if (!venue) { const inserted = await db.prepare("INSERT INTO venues (name, active) VALUES (?, 1)").bind(venueName).run(); venue = { id: Number(inserted.meta.last_row_id) }; }
      await db.prepare("UPDATE events SET venue_id = ? WHERE id = ?").bind(venue.id, eventId).run();
    }
    const adults = Number(payload.adultos ?? 0), children = Number(payload.ninos ?? 0), guests = adults + children;
    const eventName = String(payload.nombre_evento ?? "").trim();
    const eventDate = String(payload.fecha_evento ?? "").trim();
    if (eventName) await db.prepare("UPDATE events SET name = ? WHERE id = ?").bind(eventName, eventId).run();
    if (eventDate) await db.prepare("UPDATE events SET event_date = ? WHERE id = ?").bind(eventDate, eventId).run();
    if (guests > 0) await db.prepare("UPDATE events SET guests = ? WHERE id = ?").bind(guests, eventId).run();
    let amount = Number(payload.presupuesto_global ?? 0);
    if (!amount && guests > 0) amount = guests * Number(payload.presupuesto_persona ?? 0);
    if (amount > 0) await db.prepare("UPDATE budgets SET revenue = ? WHERE id = (SELECT id FROM budgets WHERE event_id = ? ORDER BY version DESC LIMIT 1)").bind(amount, eventId).run();

    const record = await db.prepare(`SELECT e.id, e.name, c.name AS client, v.name AS venue, e.event_date AS date, e.guests AS pax, e.status, COALESCE(b.revenue,0) AS amount, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.event_id=e.id AND p.status='paid'),0) AS paid, COALESCE(b.estimated_cost,0) AS costs FROM events e JOIN clients c ON c.id=e.client_id JOIN venues v ON v.id=e.venue_id LEFT JOIN budgets b ON b.id=(SELECT id FROM budgets WHERE event_id=e.id ORDER BY version DESC LIMIT 1) WHERE e.id=?`).bind(eventId).first();
    return Response.json({ saved: true, completion, event: record });
  } catch {
    return Response.json({ error: "No se pudo guardar la entrevista" }, { status: 500,headers:privateHeaders });
  }
}
