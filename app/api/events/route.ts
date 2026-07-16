import { isEditor, privateEventName, privateHeaders, requireEditor, requireSameOriginJson } from "../../editor-auth";

type EventInput = { name?: string; client?: string; venue?: string; date?: string; pax?: number; amount?: number };

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export async function GET(request:Request) {
  try {
    const db = await database();
    const result = await db.prepare(`
      SELECT e.id, e.name, c.name AS client, v.name AS venue, e.event_date AS date,
             e.guests AS pax, e.status,
             COALESCE(b.revenue, 0) AS amount,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.event_id = e.id AND p.status = 'paid'), 0) AS paid,
             COALESCE(b.estimated_cost, 0) AS costs
      FROM events e
      JOIN clients c ON c.id = e.client_id
      JOIN venues v ON v.id = e.venue_id
      LEFT JOIN budgets b ON b.id = (SELECT id FROM budgets WHERE event_id = e.id ORDER BY version DESC LIMIT 1)
      ORDER BY e.id DESC
    `).all();
    const editor=await isEditor(request);
    const events=(result.results as Array<Record<string,unknown>&{id:number}>).map(event=>editor?event:{id:event.id,name:privateEventName(event.id),client:"Cliente privado",venue:event.venue,date:event.date,pax:event.pax,status:event.status,amount:0,paid:0,costs:0});
    return Response.json({ events, editor }, { headers:privateHeaders });
  } catch {
    return Response.json({ error: "No se pudieron cargar los eventos" }, { status: 500,headers:privateHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const denied=await requireEditor(request);
    if(denied)return denied;
    const invalid=requireSameOriginJson(request);
    if(invalid)return invalid;
    const input = (await request.json()) as EventInput;
    const name = input.name?.trim();
    const clientName = input.client?.trim();
    const venueName = input.venue?.trim();
    const date = input.date?.trim();
    const pax = Number(input.pax ?? 0);
    const amount = Number(input.amount ?? 0);
    if (!name || !clientName || !venueName || !date || pax < 1 || amount < 0) return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    const db = await database();

    let client = await db.prepare("SELECT id FROM clients WHERE name = ? LIMIT 1").bind(clientName).first<{ id: number }>();
    if (!client) {
      const inserted = await db.prepare("INSERT INTO clients (name) VALUES (?)").bind(clientName).run();
      client = { id: Number(inserted.meta.last_row_id) };
    }
    let venue = await db.prepare("SELECT id FROM venues WHERE name = ? LIMIT 1").bind(venueName).first<{ id: number }>();
    if (!venue) {
      const inserted = await db.prepare("INSERT INTO venues (name, active) VALUES (?, 1)").bind(venueName).run();
      venue = { id: Number(inserted.meta.last_row_id) };
    }
    const insertedEvent = await db.prepare("INSERT INTO events (client_id, venue_id, name, event_date, guests, status) VALUES (?, ?, ?, ?, ?, 'Presupuesto')").bind(client.id, venue.id, name, date, pax).run();
    const eventId = Number(insertedEvent.meta.last_row_id);
    await db.prepare("INSERT INTO budgets (event_id, version, revenue, estimated_cost, status) VALUES (?, 1, ?, 0, 'draft')").bind(eventId, amount).run();

    return Response.json({ event: { id: eventId, name, client: clientName, venue: venueName, date, pax, status: "Presupuesto", amount, paid: 0, costs: 0 } }, { status: 201 });
  } catch {
    return Response.json({ error: "No se pudo crear el evento" }, { status: 500,headers:privateHeaders });
  }
}
