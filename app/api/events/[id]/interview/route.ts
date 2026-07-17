import { privateHeaders, requireEditor, requireSameOriginJson } from "../../../../editor-auth";
import { normalizeEventDate } from "../../../../calendar-sync";

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

type Context = { params: Promise<{ id: string }> };
type Payload = Record<string, string | number | boolean | string[]>;

function text(value:unknown) { return String(value??"").trim(); }
function validTime(value:string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function has(payload:Payload,key:string) { return Object.prototype.hasOwnProperty.call(payload,key); }
function parsePayload(value:string|null|undefined) { try{return JSON.parse(value||"{}") as Payload}catch{return {} as Payload} }

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
    if(!Number.isInteger(eventId)||eventId<1)return Response.json({error:"Evento no válido"},{status:400,headers:privateHeaders});
    const body = (await request.json()) as { payload?: Payload; completion?: number };
    const payload = body.payload ?? {};
    const completion = Math.max(0, Math.min(100, Number(body.completion ?? 0)));
    const db = await database();
    const current = await db.prepare(`
      SELECT e.client_id AS clientId,e.venue_id AS venueId,e.name,e.event_date AS eventDate,
             e.start_time AS startTime,e.end_time AS endTime,e.end_date AS endDate,e.timezone,
             e.guests,ei.payload AS interviewPayload
      FROM events e LEFT JOIN event_interviews ei ON ei.event_id=e.id WHERE e.id=?
    `).bind(eventId).first<{clientId:number;venueId:number;name:string;eventDate:string;startTime:string|null;endTime:string|null;endDate:string|null;timezone:string;guests:number;interviewPayload:string|null}>();
    if (!current) return Response.json({ error: "Evento no encontrado" }, { status: 404,headers:privateHeaders });

    const eventDateInput=text(payload.fecha_evento),eventDate=eventDateInput?normalizeEventDate(eventDateInput):null;
    if(eventDateInput&&!eventDate)return Response.json({error:"La fecha del evento no es válida"},{status:400,headers:privateHeaders});
    const startFieldsPresent=has(payload,"hora_invitados")||has(payload,"hora_servicio"),endFieldPresent=has(payload,"hora_final");
    const startInput=text(payload.hora_invitados)||text(payload.hora_servicio),endInput=text(payload.hora_final);
    if((startInput&&!validTime(startInput))||(endInput&&!validTime(endInput)))return Response.json({error:"El horario del evento no es válido"},{status:400,headers:privateHeaders});

    const clientName = text(payload.cliente);
    if (clientName) await db.prepare("UPDATE clients SET name = ?, phone = ?, email = ? WHERE id = ?").bind(clientName, String(payload.telefono ?? ""), String(payload.correo ?? ""), current.clientId).run();
    const venueName = text(payload.local);
    let venueId=current.venueId;
    if (venueName) {
      let venue = await db.prepare("SELECT id FROM venues WHERE name = ? LIMIT 1").bind(venueName).first<{ id: number }>();
      if (!venue) { const inserted = await db.prepare("INSERT INTO venues (name, active) VALUES (?, 1)").bind(venueName).run(); venue = { id: Number(inserted.meta.last_row_id) }; }
      venueId=venue.id;
    }
    const adults = Number(payload.adultos ?? 0), children = Number(payload.ninos ?? 0), guests = adults + children;
    const nextName=text(payload.nombre_evento)||current.name,nextDate=eventDate||normalizeEventDate(current.eventDate)||current.eventDate,nextGuests=guests>0?guests:current.guests;
    const nextStart=startFieldsPresent?(startInput||null):current.startTime,nextEnd=endFieldPresent?(endInput||null):current.endTime;
    const nextEndDate=eventDate&&eventDate!==current.eventDate?null:normalizeEventDate(current.endDate)||current.endDate;
    const previousPayload=parsePayload(current.interviewPayload),calendarInterviewKeys=["tipo","espacio","hora_montaje","hora_anfitriones","hora_invitados","hora_servicio","hora_final"];
    const interviewChanged=calendarInterviewKeys.some(key=>text(previousPayload[key])!==text(payload[key]));
    const calendarChanged=interviewChanged||venueId!==current.venueId||nextName!==current.name||nextDate!==current.eventDate||nextGuests!==current.guests||nextStart!==current.startTime||nextEnd!==current.endTime||nextEndDate!==current.endDate;
    await db.batch([
      db.prepare("INSERT INTO event_interviews (event_id,payload,completion,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_id) DO UPDATE SET payload=excluded.payload,completion=excluded.completion,updated_at=CURRENT_TIMESTAMP").bind(eventId,JSON.stringify(payload),completion),
      db.prepare("UPDATE events SET name=?,venue_id=?,event_date=?,start_time=?,end_time=?,end_date=?,timezone=?,guests=?,calendar_dirty=CASE WHEN ?=1 THEN 1 ELSE calendar_dirty END,calendar_revision=calendar_revision+? WHERE id=?").bind(nextName,venueId,nextDate,nextStart,nextEnd,nextEndDate,"Europe/Madrid",nextGuests,calendarChanged?1:0,calendarChanged?1:0,eventId),
    ]);
    let amount = Number(payload.presupuesto_global ?? 0);
    if (!amount && guests > 0) amount = guests * Number(payload.presupuesto_persona ?? 0);
    if (amount > 0) await db.prepare("UPDATE budgets SET revenue = ? WHERE id = (SELECT id FROM budgets WHERE event_id = ? ORDER BY version DESC LIMIT 1)").bind(amount, eventId).run();

    const record = await db.prepare(`
      SELECT e.id,e.name,c.name AS client,v.name AS venue,e.event_date AS date,
             e.start_time AS startTime,e.end_time AS endTime,e.end_date AS endDate,e.timezone,
             e.guests AS pax,e.status,e.calendar_dirty AS calendarDirty,
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
             COALESCE(b.revenue,0) AS amount,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.event_id=e.id AND p.status='paid'),0) AS paid,
             COALESCE(b.estimated_cost,0) AS costs
      FROM events e JOIN clients c ON c.id=e.client_id JOIN venues v ON v.id=e.venue_id
      LEFT JOIN budgets b ON b.id=(SELECT id FROM budgets WHERE event_id=e.id ORDER BY version DESC LIMIT 1)
      WHERE e.id=?
    `).bind(eventId).first<Record<string,unknown>>();
    return Response.json({ saved: true, completion, event:record?{...record,date:normalizeEventDate(String(record.date??""))??record.date,endDate:normalizeEventDate(String(record.endDate??""))??record.endDate,calendarDirty:Boolean(record.calendarDirty)}:record },{headers:privateHeaders});
  } catch {
    return Response.json({ error: "No se pudo guardar la entrevista" }, { status: 500,headers:privateHeaders });
  }
}
