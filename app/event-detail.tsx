"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import InterviewPanel from "./interview-panel";
import type { EventRecord } from "./page";

type TabName = "Datos generales" | "Entrevista" | "Presupuesto" | "Anticipos" | "Tareas" | "Órdenes" | "Cierre";
type Budget = { id:number; version:number; revenue:number; estimatedCost:number; status:string; createdAt:string };
type Payment = { id:number; amount:number; dueDate:string; paidAt:string|null; status:string };
type Task = { id:number; title:string; owner:string; dueDate:string|null; priority:string; completed:number|boolean };
type ServiceOrder = { id:number; department:string; instructions:string; status:string; approvedAt:string|null };
type Closure = { id:number; actualRevenue:number; actualCost:number; notes:string; closedAt:string|null } | null;
type Operations = {
  editor?: boolean;
  event: EventRecord & { phone:string; email:string };
  budgets: Budget[];
  payments: Payment[];
  tasks: Task[];
  orders: ServiceOrder[];
  closure: Closure;
};

const tabs: TabName[] = ["Datos generales", "Entrevista", "Presupuesto", "Anticipos", "Tareas", "Órdenes", "Cierre"];
const departments = ["Hostess / recepción", "Sala", "Cocina", "Montaje", "Decoración", "DJ / audiovisuales", "Animación / música", "Hinchables", "Estaciones gastronómicas", "Proveedores externos"];
const money = (value:number) => new Intl.NumberFormat("es-ES", { style:"currency", currency:"EUR", maximumFractionDigits:0 }).format(value || 0);

export default function EventDetail({ event, initialTab="Datos generales", onBack, notify, onEventUpdate, canEdit, onRequestEdit }:{ event:EventRecord; initialTab?:TabName; onBack:()=>void; notify:(message:string)=>void; onEventUpdate:(event:EventRecord)=>void; canEdit:boolean; onRequestEdit:()=>void }) {
  const [tab,setTab] = useState<TabName>(initialTab);
  const [operations,setOperations] = useState<Operations|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/events/${event.id}/operations`, { cache:"no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron cargar los datos");
      if (canEdit && body.editor === false) {
        window.location.reload();
        return;
      }
      setOperations(body);
      if (body.event) onEventUpdate(body.event);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }, [canEdit, event.id, onEventUpdate]);

  // The initial server synchronization intentionally starts when the selected event changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function mutate(action:string, payload:Record<string,unknown>) {
    if (!canEdit) {
      onRequestEdit();
      return false;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${event.id}/operations`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo guardar");
      setOperations(body);
      if (body.event) onEventUpdate(body.event);
      notify("Cambios guardados correctamente");
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo guardar";
      setError(message);
      notify(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const current = operations?.event ?? { ...event, phone:"", email:"" };
  const paid = operations ? operations.payments.filter(item => item.status === "paid").reduce((sum,item) => sum + Number(item.amount),0) : event.paid;
  const latestBudget = operations?.budgets[0];
  const revenue = Number(latestBudget?.revenue ?? event.amount);
  const costs = Number(latestBudget?.estimatedCost ?? event.costs);
  const pending = Math.max(0,revenue-paid);
  const margin = revenue ? Math.round((revenue-costs)/revenue*100) : 0;

  return <div className="content event-detail">
    <button type="button" className="back-link" onClick={onBack}>← Volver a eventos</button>
    <div className="detail-hero"><div><p className="eyebrow">EXPEDIENTE EV-{String(event.id).padStart(5,"0")}</p><h2>{current.name}</h2><p>{current.client} · {current.venue} · {current.date}</p></div><div className="detail-actions"><Status>{current.status}</Status><button type="button" className="secondary" onClick={() => canEdit ? setTab("Datos generales") : onRequestEdit()}>{canEdit ? "Editar datos" : "Activar edición"}</button><button type="button" className="primary" onClick={() => setTab("Órdenes")}>Órdenes de servicio</button></div></div>
    {canEdit ? <div className="detail-kpis"><div><small>Comensales</small><strong>{current.pax}</strong></div><div><small>Presupuesto</small><strong>{money(revenue)}</strong></div><div><small>Cobrado</small><strong>{money(paid)}</strong></div><div><small>Pendiente</small><strong>{money(pending)}</strong></div><div><small>Margen estimado</small><strong>{margin}%</strong></div></div> : <div className="read-only-banner" role="status"><div><strong>Modo consulta</strong><p>Los contactos, importes y detalles operativos están protegidos.</p></div><button type="button" className="secondary" onClick={onRequestEdit}>Activar edición</button></div>}
    <div className="detail-tabs" role="tablist" aria-label="Apartados del evento">{tabs.map(item => <button type="button" role="tab" aria-selected={tab===item} key={item} className={tab===item?"active":""} onClick={() => setTab(item)}>{item}</button>)}</div>
    {error && <div className="form-error" role="alert"><strong>No se ha podido completar la operación.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Reintentar</button></div>}
    {loading ? <div className="loading-card">Cargando expediente…</div> : <section className="detail-body">
      {tab === "Datos generales" && (canEdit ? <GeneralForm event={current} saving={saving} onSave={data => mutate("event.update",data)} /> : <ReadOnlyGeneral event={current} onRequestEdit={onRequestEdit} />)}
      {tab === "Entrevista" && (canEdit ? <InterviewPanel eventId={event.id} onEventUpdate={onEventUpdate} /> : <LockedPanel title="Entrevista del evento" onRequestEdit={onRequestEdit} />)}
      {tab === "Presupuesto" && (canEdit ? <BudgetPanel budgets={operations?.budgets ?? []} saving={saving} onSave={data => mutate("budget.create",data)} /> : <LockedPanel title="Presupuestos y control de versiones" onRequestEdit={onRequestEdit} />)}
      {tab === "Anticipos" && (canEdit ? <PaymentPanel payments={operations?.payments ?? []} revenue={revenue} saving={saving} onCreate={data => mutate("payment.create",data)} onToggle={(id,status) => mutate("payment.status",{id,status})} /> : <LockedPanel title="Anticipos y vencimientos" onRequestEdit={onRequestEdit} />)}
      {tab === "Tareas" && (canEdit ? <TaskPanel tasks={operations?.tasks ?? []} saving={saving} onCreate={data => mutate("task.create",data)} onToggle={(id,completed) => mutate("task.toggle",{id,completed})} /> : <LockedPanel title="Tareas y responsables" onRequestEdit={onRequestEdit} />)}
      {tab === "Órdenes" && (canEdit ? <OrderPanel orders={operations?.orders ?? []} saving={saving} onSave={data => mutate("order.save",data)} /> : <LockedPanel title="Órdenes de servicio" onRequestEdit={onRequestEdit} />)}
      {tab === "Cierre" && (canEdit ? <ClosurePanel closure={operations?.closure ?? null} revenue={revenue} estimatedCost={costs} saving={saving} onSave={data => mutate("closure.save",data)} /> : <LockedPanel title="Cierre económico y rentabilidad" onRequestEdit={onRequestEdit} />)}
    </section>}
  </div>;
}

function ReadOnlyGeneral({event,onRequestEdit}:{event:Operations["event"];onRequestEdit:()=>void}) {
  return <Panel title="Resumen general del evento"><div className="read-only-summary">
    <div><small>Evento</small><strong>{event.name}</strong></div>
    <div><small>Cliente</small><strong>{event.client}</strong></div>
    <div><small>Local</small><strong>{event.venue}</strong></div>
    <div><small>Fecha</small><strong>{event.date}</strong></div>
    <div><small>Comensales</small><strong>{event.pax || "—"}</strong></div>
    <div><small>Estado</small><Status>{event.status}</Status></div>
  </div><div className="locked-panel"><p>La información de contacto y los datos económicos se ocultan en el enlace público.</p><button type="button" className="primary" onClick={onRequestEdit}>Activar edición</button></div></Panel>;
}

function LockedPanel({title,onRequestEdit}:{title:string;onRequestEdit:()=>void}) {
  return <Panel title={title}><div className="locked-panel"><strong>Contenido protegido</strong><p>Introduce la clave de edición para consultar y actualizar este apartado.</p><button type="button" className="primary" onClick={onRequestEdit}>Activar edición</button></div></Panel>;
}

function GeneralForm({event,saving,onSave}:{event:Operations["event"];saving:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>}) {
  async function submit(formEvent:FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    await onSave(Object.fromEntries(form.entries()));
  }
  return <Panel title="Datos generales y CRM del cliente"><form className="record-form" onSubmit={submit} key={`${event.id}-${event.name}-${event.client}`}>
    <label className="wide">Nombre del evento<input name="name" defaultValue={event.name} required /></label>
    <label>Cliente<input name="client" defaultValue={event.client} required /></label>
    <label>Teléfono<input name="phone" type="tel" defaultValue={event.phone} /></label>
    <label>Correo electrónico<input name="email" type="email" defaultValue={event.email} /></label>
    <label>Local<select name="venue" defaultValue={event.venue}>{["Vive Roda","Olympic","Torre del Rame","Tapeoteca",event.venue].filter((value,index,array)=>array.indexOf(value)===index).map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Fecha<input name="date" defaultValue={event.date} required /></label>
    <label>Comensales<input name="pax" type="number" min="1" defaultValue={event.pax} required /></label>
    <label>Estado<select name="status" defaultValue={event.status}>{["Lead","Entrevista","Presupuesto","Pendiente anticipo","Confirmado","Operativa","Finalizado","Cancelado",event.status].filter((value,index,array)=>array.indexOf(value)===index).map(value=><option key={value}>{value}</option>)}</select></label>
    <div className="form-actions wide"><small>Estos datos alimentan el CRM, el presupuesto y las órdenes operativas.</small><button className="primary" disabled={saving}>{saving?"Guardando…":"Guardar ficha"}</button></div>
  </form></Panel>;
}

function BudgetPanel({budgets,saving,onSave}:{budgets:Budget[];saving:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>}) {
  const latest=budgets[0];
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await onSave(Object.fromEntries(form.entries()));}
  return <div className="detail-stack"><Panel title="Nueva versión de presupuesto"><form className="record-form compact" onSubmit={submit}>
    <label>Ingresos previstos (€)<input name="revenue" type="number" min="0" step="0.01" defaultValue={latest?.revenue??0} required /></label>
    <label>Costes previstos (€)<input name="estimatedCost" type="number" min="0" step="0.01" defaultValue={latest?.estimatedCost??0} required /></label>
    <label>Estado<select name="status" defaultValue="draft"><option value="draft">Borrador</option><option value="sent">Enviado</option><option value="accepted">Aceptado</option><option value="rejected">Rechazado</option></select></label>
    <div className="form-actions"><button className="primary" disabled={saving}>{saving?"Guardando…":"Guardar nueva versión"}</button></div>
  </form></Panel><Panel title="Historial y trazabilidad">{budgets.length?<div className="table-wrap"><table><thead><tr><th>Versión</th><th>Ingresos</th><th>Costes</th><th>Resultado</th><th>Margen</th><th>Estado</th></tr></thead><tbody>{budgets.map(item=>{const result=item.revenue-item.estimatedCost;return <tr key={item.id}><td>v{item.version}</td><td>{money(item.revenue)}</td><td>{money(item.estimatedCost)}</td><td>{money(result)}</td><td>{item.revenue?Math.round(result/item.revenue*100):0}%</td><td><Status>{labelStatus(item.status)}</Status></td></tr>})}</tbody></table></div>:<Empty text="Todavía no hay versiones de presupuesto."/>}</Panel></div>;
}

function PaymentPanel({payments,revenue,saving,onCreate,onToggle}:{payments:Payment[];revenue:number;saving:boolean;onCreate:(data:Record<string,unknown>)=>Promise<boolean>;onToggle:(id:number,status:string)=>Promise<boolean>}) {
  const paid=payments.filter(item=>item.status==="paid").reduce((sum,item)=>sum+Number(item.amount),0);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);if(await onCreate(Object.fromEntries(form.entries())))formElement.reset();}
  return <div className="detail-stack"><div className="summary-strip"><div><small>Contratado</small><strong>{money(revenue)}</strong></div><div><small>Cobrado</small><strong>{money(paid)}</strong></div><div><small>Pendiente</small><strong>{money(Math.max(0,revenue-paid))}</strong></div></div><Panel title="Programar anticipo o registrar cobro"><form className="record-form compact" onSubmit={submit}>
    <label>Importe (€)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Vencimiento<input name="dueDate" type="date" required /></label><label>Estado<select name="status"><option value="pending">Pendiente</option><option value="paid">Cobrado</option></select></label><div className="form-actions"><button className="primary" disabled={saving}>Añadir movimiento</button></div>
  </form></Panel><Panel title="Vencimientos y cobros">{payments.length?<div className="action-list">{payments.map(item=><div key={item.id}><span className={item.status==="paid"?"check done":"check"}>{item.status==="paid"?"✓":""}</span><div><strong>{money(item.amount)}</strong><small>Vence: {item.dueDate}{item.paidAt?` · Cobrado: ${item.paidAt}`:""}</small></div><Status>{labelStatus(item.status)}</Status><button type="button" className="mini" disabled={saving} onClick={()=>void onToggle(item.id,item.status==="paid"?"pending":"paid")}>{item.status==="paid"?"Marcar pendiente":"Marcar cobrado"}</button></div>)}</div>:<Empty text="No hay anticipos programados."/>}</Panel></div>;
}

function TaskPanel({tasks,saving,onCreate,onToggle}:{tasks:Task[];saving:boolean;onCreate:(data:Record<string,unknown>)=>Promise<boolean>;onToggle:(id:number,completed:boolean)=>Promise<boolean>}) {
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);if(await onCreate(Object.fromEntries(form.entries())))formElement.reset();}
  return <div className="detail-stack"><Panel title="Nueva tarea"><form className="record-form" onSubmit={submit}><label className="wide">Tarea<input name="title" required placeholder="Ej. Confirmar menú y alérgenos" /></label><label>Responsable<input name="owner" required placeholder="Ignacio, Pepe, Sergio…" /></label><label>Fecha límite<input name="dueDate" type="date" /></label><label>Prioridad<select name="priority"><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option><option value="low">Baja</option></select></label><div className="form-actions"><button className="primary" disabled={saving}>Añadir tarea</button></div></form></Panel><Panel title="Seguimiento por responsables">{tasks.length?<div className="action-list">{tasks.map(item=><div key={item.id}><button type="button" className={Boolean(item.completed)?"check done":"check"} aria-label={Boolean(item.completed)?"Reabrir tarea":"Completar tarea"} onClick={()=>void onToggle(item.id,!Boolean(item.completed))}>{Boolean(item.completed)?"✓":""}</button><div><strong>{item.title}</strong><small>{item.owner} · {item.dueDate||"Sin fecha"}</small></div><Status>{priorityLabel(item.priority)}</Status></div>)}</div>:<Empty text="No hay tareas asignadas a este evento."/>}</Panel></div>;
}

function OrderPanel({orders,saving,onSave}:{orders:ServiceOrder[];saving:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>}) {
  const [department,setDepartment]=useState(departments[0]);
  const existing=orders.find(item=>item.department===department);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await onSave(Object.fromEntries(form.entries()));}
  return <div className="detail-stack"><Panel title="Instrucción operativa por departamento o proveedor"><form className="record-form" onSubmit={submit} key={`${department}-${existing?.id??"new"}`}><label>Área / profesional<select name="department" value={department} onChange={event=>setDepartment(event.target.value)}>{departments.map(item=><option key={item}>{item}</option>)}</select></label><label>Estado<select name="status" defaultValue={existing?.status??"draft"}><option value="draft">Borrador</option><option value="sent">Enviada</option><option value="validated">Validada</option><option value="completed">Completada</option></select></label><label className="wide">Instrucciones, horarios, contactos, material y responsabilidades<textarea name="instructions" rows={7} defaultValue={existing?.instructions??""} placeholder="Qué debe hacer, quién lo valida, hora de llegada, montaje, desmontaje, necesidades técnicas y contacto…" required /></label><div className="form-actions wide"><button className="primary" disabled={saving}>{existing?"Actualizar orden":"Crear orden"}</button></div></form></Panel><Panel title="Estado de las órdenes">{orders.length?<div className="department-grid">{orders.map(item=><button type="button" className="department-card" key={item.id} onClick={()=>setDepartment(item.department)}><strong>{item.department}</strong><Status>{labelStatus(item.status)}</Status><p>{item.instructions||"Sin instrucciones"}</p><small>Editar orden ›</small></button>)}</div>:<Empty text="Crea una orden para cada departamento y profesional externo que intervenga."/>}</Panel></div>;
}

function ClosurePanel({closure,revenue,estimatedCost,saving,onSave}:{closure:Closure;revenue:number;estimatedCost:number;saving:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>}) {
  const actualRevenue=Number(closure?.actualRevenue??revenue),actualCost=Number(closure?.actualCost??estimatedCost),result=actualRevenue-actualCost;
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await onSave(Object.fromEntries(form.entries()));}
  return <div className="detail-stack"><div className="budget-summary"><div><span>Ingreso previsto</span><strong>{money(revenue)}</strong></div><div><span>Coste previsto</span><strong>{money(estimatedCost)}</strong></div><div><span>Resultado real actual</span><strong>{money(result)}</strong></div><div><span>Desviación de coste</span><strong>{money(actualCost-estimatedCost)}</strong></div></div><Panel title="Cierre económico y aprendizaje"><form className="record-form" onSubmit={submit} key={closure?.id??"new"}><label>Ingresos reales (€)<input name="actualRevenue" type="number" min="0" step="0.01" defaultValue={actualRevenue} required /></label><label>Costes reales (€)<input name="actualCost" type="number" min="0" step="0.01" defaultValue={actualCost} required /></label><label>Fecha de cierre<input name="closedAt" type="date" defaultValue={closure?.closedAt?.slice(0,10)??""} /></label><label className="wide">Incidencias, desviaciones y mejoras para próximos eventos<textarea name="notes" rows={6} defaultValue={closure?.notes??""} /></label><div className="form-actions wide"><button className="primary" disabled={saving}>{closure?"Actualizar cierre":"Cerrar evento"}</button></div></form></Panel></div>;
}

function Panel({title,children}:{title:string;children:ReactNode}){return <article className="panel"><div className="panel-head"><h2>{title}</h2></div>{children}</article>}
function Status({children}:{children:ReactNode}){const key=String(children).toLowerCase().replaceAll(" ","-");return <span className={`status ${key}`}>{children}</span>}
function Empty({text}:{text:string}){return <div className="empty-state"><strong>Sin registros</strong><p>{text}</p></div>}
function labelStatus(value:string){return ({draft:"Borrador",sent:"Enviado",accepted:"Aceptado",rejected:"Rechazado",pending:"Pendiente",paid:"Cobrado",validated:"Validada",completed:"Completada"} as Record<string,string>)[value]??value}
function priorityLabel(value:string){return ({low:"Baja",medium:"Media",high:"Alta",critical:"Crítica"} as Record<string,string>)[value]??value}
