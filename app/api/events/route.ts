import { isEditor, privateEventName, privateHeaders, requireEditor, requireSameOriginJson } from "../../editor-auth";
import { normalizeEventDate } from "../../calendar-sync";

type EventInput = { name?: string; client?: string; venue?: string; date?: string; startTime?:string; endTime?:string; endDate?:string; timezone?:string; pax?: number; amount?: number };

function validTime(value:string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export async function GET(request:Request) {
  try {
    const db = await database();
    const result = await db.prepare(`
      SELECT e.id, e.name, c.name AS client, v.name AS venue, e.event_date AS date,
             e.start_time AS startTime,e.end_time AS endTime,e.end_date AS endDate,e.timezone,
             e.guests AS pax, e.status,e.calendar_dirty AS calendarDirty,
             CASE
               WHEN EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.sync_state='error')
                    AND EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.sync_state='synced') THEN 'partial'
               WHEN EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.sync_state='error') THEN 'error'
               WHEN e.calendar_dirty=1 THEN 'pending'
               WHEN v.google_calendar_id IS NULL AND EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.target_kind='master' AND cs.sync_state='synced') THEN 'partial'
               WHEN EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.target_kind='venue' AND cs.target_calendar_id=v.google_calendar_id AND cs.sync_state='synced')
                    AND EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.target_kind='master' AND cs.sync_state='synced') THEN 'synced'
               ELSE 'pending'
             END AS calendarStatus,
             (SELECT MAX(cs.synced_at) FROM event_calendar_syncs cs WHERE cs.event_id=e.id AND cs.sync_state='synced') AS calendarSyncedAt,
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
    const events=(result.results as Array<Record<string,unknown>&{id:number}>).map(event=>{
      const normalizedDate=normalizeEventDate(String(event.date??""))??event.date;
      const normalizedEndDate=normalizeEventDate(String(event.endDate??""))??event.endDate;
      return editor?{...event,date:normalizedDate,endDate:normalizedEndDate,calendarDirty:Boolean(event.calendarDirty)}:{id:event.id,name:privateEventName(event.id),client:"Cliente privado",venue:event.venue,date:normalizedDate,pax:event.pax,status:event.status,amount:0,paid:0,costs:0};
    });
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
    const date = normalizeEventDate(input.date?.trim());
    const startInput=String(input.startTime??"").trim(),endInput=String(input.endTime??"").trim(),endDateInput=String(input.endDate??"").trim();
    if((startInput&&!validTime(startInput))||(endInput&&!validTime(endInput)))return Response.json({error:"El horario no es válido"},{status:400,headers:privateHeaders});
    const startTime=startInput||null,endTime=endInput||null,endDate=endDateInput?normalizeEventDate(endDateInput):null,timezone=input.timezone==="Europe/Madrid"?input.timezone:"Europe/Madrid";
    if(endDateInput&&!endDate)return Response.json({error:"La fecha de finalización no es válida"},{status:400,headers:privateHeaders});
    if(endDate&&date&&endDate<date)return Response.json({error:"La fecha de finalización no puede ser anterior al evento"},{status:400,headers:privateHeaders});
    const pax = Number(input.pax ?? 0);
    const amount = Number(input.amount ?? 0);
    if (!name || !clientName || !venueName || !date || pax < 1 || amount < 0) return Response.json({ error: "Faltan datos obligatorios" }, { status: 400,headers:privateHeaders });
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
    const insertedEvent = await db.prepare("INSERT INTO events (client_id, venue_id, name, event_date, start_time, end_time, end_date, timezone, calendar_dirty, calendar_revision, guests, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'Presupuesto')").bind(client.id, venue.id, name, date, startTime, endTime, endDate, timezone, pax).run();
    const eventId = Number(insertedEvent.meta.last_row_id);
    await db.prepare("INSERT INTO budgets (event_id, version, revenue, estimated_cost, status) VALUES (?, 1, ?, 0, 'draft')").bind(eventId, amount).run();

    return Response.json({ event: { id: eventId, name, client: clientName, venue: venueName, date, startTime, endTime, endDate, timezone, pax, status: "Presupuesto", amount, paid: 0, costs: 0, calendarStatus:"pending", calendarDirty:true, calendarSyncedAt:null } }, { status: 201,headers:privateHeaders });
  } catch {
    return Response.json({ error: "No se pudo crear el evento" }, { status: 500,headers:privateHeaders });
  }
}
