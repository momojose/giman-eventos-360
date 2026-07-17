import { isEditor, privateEventName, privateHeaders, requireEditor, requireSameOriginJson } from "../../../../editor-auth";
import { normalizeEventDate } from "../../../../calendar-sync";

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

type Context = { params: Promise<{ id:string }> };
type Input = Record<string, unknown> & { action?:string };

function text(value:unknown) { return String(value ?? "").trim(); }
function number(value:unknown) { const parsed=Number(value); return Number.isFinite(parsed)?parsed:0; }
function validTime(value:string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function normalizedEvent(event:Record<string,unknown>) {
  return {...event,date:normalizeEventDate(String(event.date??""))??event.date,endDate:normalizeEventDate(String(event.endDate??""))??event.endDate,calendarDirty:Boolean(event.calendarDirty)};
}

async function snapshot(db:D1Database,eventId:number) {
  const event = await db.prepare(`
    SELECT e.id,e.name,c.name AS client,COALESCE(c.phone,'') AS phone,COALESCE(c.email,'') AS email,
           v.name AS venue,e.event_date AS date,e.guests AS pax,e.status,
           e.start_time AS startTime,e.end_time AS endTime,e.end_date AS endDate,e.timezone,
           e.calendar_dirty AS calendarDirty,
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
    FROM events e
    JOIN clients c ON c.id=e.client_id
    JOIN venues v ON v.id=e.venue_id
    LEFT JOIN budgets b ON b.id=(SELECT id FROM budgets WHERE event_id=e.id ORDER BY version DESC,id DESC LIMIT 1)
    WHERE e.id=?
  `).bind(eventId).first();
  if (!event) return null;
  const [budgets,payments,tasks,orders,closure] = await Promise.all([
    db.prepare("SELECT id,version,revenue,estimated_cost AS estimatedCost,status,created_at AS createdAt FROM budgets WHERE event_id=? ORDER BY version DESC,id DESC").bind(eventId).all(),
    db.prepare("SELECT id,amount,due_date AS dueDate,paid_at AS paidAt,status FROM payments WHERE event_id=? ORDER BY due_date,id").bind(eventId).all(),
    db.prepare("SELECT id,title,owner,due_date AS dueDate,priority,completed FROM tasks WHERE event_id=? ORDER BY completed,due_date,id").bind(eventId).all(),
    db.prepare("SELECT id,department,instructions,status,approved_at AS approvedAt FROM service_orders WHERE event_id=? ORDER BY department,id").bind(eventId).all(),
    db.prepare("SELECT id,actual_revenue AS actualRevenue,actual_cost AS actualCost,notes,closed_at AS closedAt FROM closures WHERE event_id=? ORDER BY id DESC LIMIT 1").bind(eventId).first(),
  ]);
  return { event, budgets:budgets.results, payments:payments.results, tasks:tasks.results, orders:orders.results, closure:closure??null };
}

export async function GET(request:Request,context:Context) {
  try {
    const { id }=await context.params,eventId=Number(id);
    if (!Number.isInteger(eventId)||eventId<1) return Response.json({error:"Evento no válido"},{status:400});
    const db=await database(),result=await snapshot(db,eventId);
    if(!result)return Response.json({error:"Evento no encontrado"},{status:404});
    if(await isEditor(request))return Response.json({...result,event:normalizedEvent(result.event as Record<string,unknown>),editor:true},{headers:privateHeaders});
    const eventRecord=result.event as Record<string,unknown>&{id:number};
    const safe={editor:false,event:{id:eventRecord.id,name:privateEventName(eventId),client:"Cliente privado",phone:"",email:"",venue:eventRecord.venue,date:normalizeEventDate(String(eventRecord.date??""))??eventRecord.date,pax:eventRecord.pax,status:eventRecord.status,amount:0,paid:0,costs:0},budgets:[],payments:[],tasks:[],orders:(result.orders as Array<Record<string,unknown>>).map(order=>({id:order.id,department:order.department,instructions:"Contenido disponible en modo edición",status:order.status,approvedAt:order.approvedAt})),closure:null};
    return Response.json(safe,{headers:privateHeaders});
  } catch {
    return Response.json({error:"No se pudo cargar el expediente"},{status:500,headers:privateHeaders});
  }
}

export async function POST(request:Request,context:Context) {
  try {
    const denied=await requireEditor(request);
    if(denied)return denied;
    const invalid=requireSameOriginJson(request);
    if(invalid)return invalid;
    const { id }=await context.params,eventId=Number(id),input=(await request.json()) as Input,action=text(input.action);
    if (!Number.isInteger(eventId)||eventId<1) return Response.json({error:"Evento no válido"},{status:400});
    const db=await database();
    const existing=await db.prepare("SELECT id,client_id AS clientId FROM events WHERE id=?").bind(eventId).first<{id:number;clientId:number}>();
    if (!existing) return Response.json({error:"Evento no encontrado"},{status:404});

    if (action==="event.update") {
      const name=text(input.name),client=text(input.client),phone=text(input.phone),email=text(input.email),venueName=text(input.venue),date=normalizeEventDate(text(input.date)),status=text(input.status),pax=Math.round(number(input.pax));
      const startInput=text(input.startTime),endInput=text(input.endTime),endDateInput=text(input.endDate),timezone="Europe/Madrid";
      if((startInput&&!validTime(startInput))||(endInput&&!validTime(endInput)))return Response.json({error:"El horario no es válido"},{status:400,headers:privateHeaders});
      const endDate=endDateInput?normalizeEventDate(endDateInput):null;
      if(endDateInput&&!endDate)return Response.json({error:"La fecha de finalización no es válida"},{status:400,headers:privateHeaders});
      if(endDate&&date&&endDate<date)return Response.json({error:"La fecha de finalización no puede ser anterior al evento"},{status:400,headers:privateHeaders});
      if (!name||!client||!venueName||!date||pax<1) return Response.json({error:"Completa nombre, cliente, local, fecha y comensales"},{status:400,headers:privateHeaders});
      let venue=await db.prepare("SELECT id FROM venues WHERE name=? LIMIT 1").bind(venueName).first<{id:number}>();
      if(!venue){const created=await db.prepare("INSERT INTO venues (name,active) VALUES (?,1)").bind(venueName).run();venue={id:Number(created.meta.last_row_id)}}
      await db.batch([
        db.prepare("UPDATE clients SET name=?,phone=?,email=? WHERE id=?").bind(client,phone,email,existing.clientId),
        db.prepare("UPDATE events SET name=?,venue_id=?,event_date=?,start_time=?,end_time=?,end_date=?,timezone=?,guests=?,status=?,calendar_dirty=1,calendar_revision=calendar_revision+1 WHERE id=?").bind(name,venue.id,date,startInput||null,endInput||null,endDate,timezone,pax,status||"Lead",eventId),
      ]);
    } else if (action==="budget.create") {
      const revenue=number(input.revenue),estimatedCost=number(input.estimatedCost),status=text(input.status)||"draft";
      if(revenue<0||estimatedCost<0)return Response.json({error:"Los importes no pueden ser negativos"},{status:400});
      const latest=await db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM budgets WHERE event_id=?").bind(eventId).first<{version:number}>();
      await db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (?,?,?,?,?)").bind(eventId,Number(latest?.version??0)+1,revenue,estimatedCost,status).run();
    } else if (action==="payment.create") {
      const amount=number(input.amount),dueDate=text(input.dueDate),status=text(input.status)==="paid"?"paid":"pending";
      if(amount<=0||!dueDate)return Response.json({error:"Indica un importe y un vencimiento válidos"},{status:400});
      await db.prepare("INSERT INTO payments (event_id,amount,due_date,paid_at,status) VALUES (?,?,?,CASE WHEN ?='paid' THEN CURRENT_TIMESTAMP ELSE NULL END,?)").bind(eventId,amount,dueDate,status,status).run();
    } else if (action==="payment.status") {
      const paymentId=Math.round(number(input.id)),status=text(input.status)==="paid"?"paid":"pending";
      await db.prepare("UPDATE payments SET status=?,paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=? AND event_id=?").bind(status,status,paymentId,eventId).run();
    } else if (action==="task.create") {
      const title=text(input.title),owner=text(input.owner),dueDate=text(input.dueDate),priority=text(input.priority)||"medium";
      if(!title||!owner)return Response.json({error:"Indica la tarea y su responsable"},{status:400});
      await db.prepare("INSERT INTO tasks (event_id,title,owner,due_date,priority,completed) VALUES (?,?,?,?,?,0)").bind(eventId,title,owner,dueDate||null,priority).run();
    } else if (action==="task.toggle") {
      const taskId=Math.round(number(input.id)),completed=input.completed===true||input.completed===1||input.completed==="true";
      await db.prepare("UPDATE tasks SET completed=? WHERE id=? AND event_id=?").bind(completed?1:0,taskId,eventId).run();
    } else if (action==="order.save") {
      const department=text(input.department),instructions=text(input.instructions),status=text(input.status)||"draft";
      if(!department||!instructions)return Response.json({error:"Selecciona el área y completa sus instrucciones"},{status:400});
      const order=await db.prepare("SELECT id FROM service_orders WHERE event_id=? AND department=? ORDER BY id DESC LIMIT 1").bind(eventId,department).first<{id:number}>();
      if(order)await db.prepare("UPDATE service_orders SET instructions=?,status=?,approved_at=CASE WHEN ? IN ('validated','completed') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?").bind(instructions,status,status,order.id).run();
      else await db.prepare("INSERT INTO service_orders (event_id,department,instructions,status,approved_at) VALUES (?,?,?,?,CASE WHEN ? IN ('validated','completed') THEN CURRENT_TIMESTAMP ELSE NULL END)").bind(eventId,department,instructions,status,status).run();
    } else if (action==="closure.save") {
      const actualRevenue=number(input.actualRevenue),actualCost=number(input.actualCost),notes=text(input.notes),closedAt=text(input.closedAt)||null;
      if(actualRevenue<0||actualCost<0)return Response.json({error:"Los importes no pueden ser negativos"},{status:400});
      const closure=await db.prepare("SELECT id FROM closures WHERE event_id=? ORDER BY id DESC LIMIT 1").bind(eventId).first<{id:number}>();
      if(closure)await db.prepare("UPDATE closures SET actual_revenue=?,actual_cost=?,notes=?,closed_at=? WHERE id=?").bind(actualRevenue,actualCost,notes,closedAt,closure.id).run();
      else await db.prepare("INSERT INTO closures (event_id,actual_revenue,actual_cost,notes,closed_at) VALUES (?,?,?,?,?)").bind(eventId,actualRevenue,actualCost,notes,closedAt).run();
    } else {
      return Response.json({error:"Acción no reconocida"},{status:400});
    }

    const result=await snapshot(db,eventId);
    return Response.json(result?{...result,event:normalizedEvent(result.event as Record<string,unknown>)}:result,{headers:privateHeaders});
  } catch {
    return Response.json({error:"No se pudo guardar el expediente"},{status:500,headers:privateHeaders});
  }
}
