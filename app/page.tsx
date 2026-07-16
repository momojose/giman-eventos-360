"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import EventDetail from "./event-detail";

type Section = "Resumen" | "Eventos" | "Clientes" | "Presupuestos" | "Anticipos" | "Tareas" | "Órdenes" | "Cierres";

const venues = ["Todos los locales", "Vive Roda", "Olympic", "Torre del Rame", "Tapeoteca"];
const nav: { label: Section; icon: string }[] = [
  { label: "Resumen", icon: "▦" }, { label: "Eventos", icon: "◇" }, { label: "Clientes", icon: "♙" },
  { label: "Presupuestos", icon: "€" }, { label: "Anticipos", icon: "▣" }, { label: "Tareas", icon: "✓" },
  { label: "Órdenes", icon: "▤" }, { label: "Cierres", icon: "▥" },
];

export type EventRecord = { id: number; name: string; client: string; venue: string; date: string; pax: number; status: string; amount: number; paid: number; costs: number };

const seedEvents: EventRecord[] = [
  { id: 1, name: "Boda Martínez · Navarro", client: "Laura Martínez", venue: "Vive Roda", date: "18 jul 2026", pax: 180, status: "Confirmado", amount: 21600, paid: 12000, costs: 13200 },
  { id: 2, name: "Cena corporativa Soltec", client: "Soltec Energías", venue: "Olympic", date: "22 jul 2026", pax: 96, status: "Operativa", amount: 9120, paid: 4560, costs: 6260 },
  { id: 3, name: "Aniversario Familia Vidal", client: "María Vidal", venue: "Torre del Rame", date: "25 jul 2026", pax: 140, status: "Pendiente anticipo", amount: 14700, paid: 0, costs: 9260 },
  { id: 4, name: "Presentación Bodegas Luzón", client: "Bodegas Luzón", venue: "Tapeoteca", date: "29 jul 2026", pax: 65, status: "Presupuesto", amount: 5850, paid: 0, costs: 4785 },
  { id: 5, name: "Comunión Vega", client: "Familia Pérez", venue: "Vive Roda", date: "2 may 2027", pax: 82, status: "Confirmado", amount: 8200, paid: 2500, costs: 5100 },
];

type TaskRecord = { id:number;title:string;event:string;owner:string;due:string;priority:string;done:boolean|number };

const money = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const priorityLabel = (value:string) => ({low:"Baja",medium:"Media",high:"Alta",critical:"Crítica"} as Record<string,string>)[value] ?? value;

export default function Home() {
  const [section, setSection] = useState<Section>("Resumen");
  const [venue, setVenue] = useState(venues[0]);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState(seedEvents);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
  const [selectedEventTab, setSelectedEventTab] = useState<"Datos generales"|"Entrevista"|"Presupuesto"|"Anticipos"|"Tareas"|"Órdenes"|"Cierre">("Datos generales");

  useEffect(() => {
    fetch("/api/events")
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(({ events: saved }: { events: EventRecord[] }) => {
        if (saved?.length) setEvents(current => [...saved, ...current.filter(item => !saved.some(savedItem => savedItem.id === item.id))]);
      })
      .catch(() => undefined);
  }, []);
  useEffect(()=>{if(section!=="Tareas"||selectedEvent)return;fetch("/api/tasks",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject()).then(({tasks:saved}:{tasks:TaskRecord[]})=>setTasks(saved)).catch(()=>notify("No se pudieron cargar las tareas"))},[section,selectedEvent]);

  const filtered = useMemo(() => events.filter(e => (venue === venues[0] || e.venue === venue) && `${e.name} ${e.client} ${e.venue}`.toLowerCase().includes(query.toLowerCase())), [events, venue, query]);
  const totals = useMemo(() => filtered.reduce((a, e) => ({ revenue: a.revenue + e.amount, paid: a.paid + e.paid, costs: a.costs + e.costs }), { revenue: 0, paid: 0, costs: 0 }), [filtered]);
  const margin = totals.revenue ? ((totals.revenue - totals.costs) / totals.revenue) * 100 : 0;

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  function navigate(nextSection: Section) {
    setSelectedEvent(null);
    setSection(nextSection);
  }
  function openEvent(event:EventRecord, tab:typeof selectedEventTab="Datos generales") {
    setSelectedEventTab(tab);
    setSelectedEvent(event);
  }
  const updateSelectedEvent = useCallback((updated: EventRecord) => {
    setSelectedEvent(updated);
    setEvents(current => current.map(item => item.id === updated.id ? updated : item));
  }, []);
  async function addEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const draft = { name: String(data.get("name")), client: String(data.get("client")), venue: String(data.get("venue")), date: String(data.get("date")), pax: Number(data.get("pax")), amount: Number(data.get("amount")) };
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error("No se pudo guardar");
      const { event } = (await response.json()) as { event: EventRecord };
      setEvents(prev => [event, ...prev]);
      setShowNew(false);
      setSelectedEventTab("Entrevista");
      setSelectedEvent(event);
      notify("Evento guardado y ficha abierta");
    } catch {
      notify("No se pudo guardar el evento. Inténtalo de nuevo");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("Resumen")} aria-label="Ir al resumen"><span className="brand-mark">G<span>⌁</span></span><strong>GIMAN</strong><small>EVENTOS 360</small></button>
        <nav>{nav.map(item => <button key={item.label} className={section === item.label && !selectedEvent ? "active" : ""} onClick={() => navigate(item.label)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="help"><button><span>?</span> Ayuda</button><p>Primera versión · julio 2026</p></div>
      </aside>

      <main className="main">
        <header>
          <div><p className="eyebrow">GESTIÓN COMERCIAL Y OPERATIVA</p><h1>{section === "Resumen" ? "Panel ejecutivo" : section}</h1></div>
          <div className="header-actions">
            <label className="select-wrap"><span>⌂</span><select value={venue} onChange={e => setVenue(e.target.value)}>{venues.map(v => <option key={v}>{v}</option>)}</select></label>
            <label className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar evento o cliente…" /></label>
            <button className="notification" onClick={() => notify("Tienes 4 alertas activas")}>♧<b>4</b></button>
            <button className="avatar">JM</button>
          </div>
        </header>

        {selectedEvent ? <EventDetail event={selectedEvent} initialTab={selectedEventTab} onBack={() => setSelectedEvent(null)} notify={notify} onEventUpdate={updateSelectedEvent} /> : <>
        {section === "Resumen" && <Dashboard events={filtered} totals={totals} margin={margin} go={setSection} onNew={() => setShowNew(true)} onOpen={event => openEvent(event)} />}
        {section === "Eventos" && <EventsView events={filtered} onNew={() => setShowNew(true)} notify={notify} onOpen={event => openEvent(event)} />}
        {section === "Clientes" && <ClientsView events={filtered} onOpen={event => openEvent(event)} />}
        {section === "Presupuestos" && <BudgetsView events={filtered} onOpen={event => openEvent(event,"Presupuesto")} />}
        {section === "Anticipos" && <PaymentsView events={filtered} onOpen={event => openEvent(event,"Anticipos")} />}
        {section === "Tareas" && <TasksView tasks={tasks} setTasks={setTasks} notify={notify} />}
        {section === "Órdenes" && <OrdersView events={filtered} onOpen={event => openEvent(event,"Órdenes")} />}
        {section === "Cierres" && <ClosuresView events={filtered} onOpen={event => openEvent(event,"Cierre")} />}
        </>}
      </main>

      {showNew && <div className="modal-backdrop" onMouseDown={() => setShowNew(false)}><form className="modal" onSubmit={addEvent} onMouseDown={e => e.stopPropagation()}><div className="modal-title"><div><p className="eyebrow">NUEVO EXPEDIENTE</p><h2>Crear evento</h2></div><button type="button" onClick={() => setShowNew(false)}>×</button></div><div className="form-grid"><label>Nombre del evento<input name="name" required placeholder="Ej. Boda García · López" /></label><label>Cliente<input name="client" required placeholder="Nombre o empresa" /></label><label>Local<select name="venue">{venues.slice(1).map(v => <option key={v}>{v}</option>)}</select></label><label>Fecha<input name="date" type="date" required /></label><label>Comensales<input name="pax" type="number" required min="1" /></label><label>Importe previsto (€)<input name="amount" type="number" required min="0" step="0.01" /></label></div><div className="modal-footer"><button type="button" className="secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="primary">Crear evento y abrir entrevista</button></div></form></div>}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function Dashboard({ events, totals, margin, go, onNew, onOpen }: { events: EventRecord[]; totals: { revenue: number; paid: number; costs: number }; margin: number; go: (s: Section) => void; onNew: () => void; onOpen: (event: EventRecord) => void }) {
  const pending = totals.revenue - totals.paid;
  return <div className="content"><div className="page-toolbar"><p>Información consolidada · actualización en tiempo real</p><button className="primary" onClick={onNew}>＋ Nuevo evento</button></div><section className="kpi-grid">
    <Kpi icon="€" label="Facturación prevista" value={money(totals.revenue)} foot="↑ 12,4%" />
    <Kpi icon="⌁" label="Margen estimado" value={`${margin.toFixed(1)}%`} foot="↑ 2,1 pt" />
    <Kpi icon="◇" label="Eventos activos" value={String(events.length)} foot={`${events.filter(e => e.status === "Confirmado").length} confirmados`} />
    <Kpi icon="▣" label="Anticipos pendientes" value={money(pending)} foot="3 vencimientos próximos" danger />
  </section><section className="dashboard-grid"><Panel title="Próximos eventos" action="Ver todos" onAction={() => go("Eventos")} className="events-panel"><EventTable events={events.slice(0, 4)} onOpen={onOpen} /></Panel><Panel title="Alertas y vencimientos" action="Ver todas" onAction={() => go("Anticipos")}><div className="alerts"><Alert tone="red" icon="◷" title="Anticipo vence hoy · Boda Martínez" detail="Importe pendiente: 9.600 €" /><Alert tone="amber" icon="♨" title="Orden de cocina sin validar · Olympic" detail="Debe validarse antes del 20 de julio" /><Alert tone="amber" icon="!" title="3 tareas críticas · Torre del Rame" detail="Vencen en las próximas 24 horas" /><Alert tone="red" icon="⌁" title="Margen bajo · Bodegas Luzón" detail="Margen estimado: 18,2%" /></div></Panel></section>
  <section className="dashboard-grid lower"><Panel title="Rentabilidad por local"><div className="bars">{[["Vive Roda",36],["Olympic",29],["Torre del Rame",32],["Tapeoteca",27]].map(([n,v]) => <div key={String(n)}><strong>{v}%</strong><span style={{ height: `${Number(v)*2.5}px` }}></span><small>{n}</small></div>)}</div></Panel><Panel title="Carga operativa"><div className="load-list">{[["Eventos",67],["Cocina",70],["Montaje",60],["Logística",45]].map(([n,v]) => <div key={String(n)}><label><span>{n}</span><b>{v}%</b></label><i><em style={{ width: `${v}%` }} /></i></div>)}</div></Panel></section></div>;
}

function Kpi({ icon,label,value,foot,danger=false }: { icon:string;label:string;value:string;foot:string;danger?:boolean }) { return <article className="kpi"><div className="kpi-icon">{icon}</div><div><p>{label}</p><strong>{value}</strong><small className={danger ? "danger" : "positive"}>{foot}</small></div></article>; }
function Panel({ title, action, onAction, className="", children }: { title:string;action?:string;onAction?:()=>void;className?:string;children:React.ReactNode }) { return <article className={`panel ${className}`}><div className="panel-head"><h2>{title}</h2>{action && <button onClick={onAction}>{action} ›</button>}</div>{children}</article>; }
function Alert({tone,icon,title,detail}:{tone:string;icon:string;title:string;detail:string}) { return <button className="alert"><span className={tone}>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><b>›</b></button>; }
function Status({ children }:{children:React.ReactNode}) { const key=String(children).toLowerCase().replaceAll(" ","-"); return <span className={`status ${key}`}>{children}</span>; }
function EventTable({ events, onOpen }:{events:EventRecord[];onOpen?:(event:EventRecord)=>void}) { return <div className="table-wrap"><table><thead><tr><th>Evento</th><th>Local</th><th>Fecha</th><th>Pax</th><th>Estado</th><th></th></tr></thead><tbody>{events.map(e => <tr key={e.id} className={onOpen ? "clickable-row" : ""} onClick={() => onOpen?.(e)}><td><strong>{e.name}</strong><small>{e.client}</small></td><td>{e.venue}</td><td>{e.date}</td><td>{e.pax}</td><td><Status>{e.status}</Status></td><td>{onOpen ? <button className="row-open" aria-label={`Abrir ${e.name}`}>›</button> : "•••"}</td></tr>)}</tbody></table></div>; }

function ViewShell({ title, intro, action, children }:{title:string;intro:string;action?:React.ReactNode;children:React.ReactNode}) { return <div className="content"><div className="view-heading"><div><h2>{title}</h2><p>{intro}</p></div>{action}</div>{children}</div>; }
function EventsView({events,onNew,notify,onOpen}:{events:EventRecord[];onNew:()=>void;notify:(s:string)=>void;onOpen:(event:EventRecord)=>void}) { return <ViewShell title="Agenda de eventos" intro="Del primer contacto al cierre económico, en un único expediente." action={<button className="primary" onClick={onNew}>＋ Nuevo evento</button>}><div className="stage-row">{[["Prospectos",1],["Presupuestados",1],["Confirmados",2],["En operación",1]].map(x=><div key={String(x[0])}><small>{x[0]}</small><strong>{x[1]}</strong></div>)}</div><Panel title="Todos los eventos"><EventTable events={events} onOpen={onOpen}/><button className="text-action" onClick={()=>notify("Calendario actualizado")}>Actualizar calendario</button></Panel></ViewShell>; }
function ClientsView({events,onOpen}:{events:typeof seedEvents;onOpen:(event:EventRecord)=>void}) { const clients=[...new Map(events.map(e=>[e.client,e])).values()]; return <ViewShell title="Clientes" intro="Historial comercial, facturación y próximos pasos."><div className="card-grid">{clients.map(c=><article className="entity-card" key={c.client}><div className="entity-avatar">{c.client.split(" ").map(x=>x[0]).slice(0,2).join("")}</div><div><h3>{c.client}</h3><p>{c.name}</p><small>{c.venue} · {money(c.amount)}</small></div><button type="button" aria-label={`Abrir ficha de ${c.client}`} onClick={()=>onOpen(c)}>›</button></article>)}</div></ViewShell>; }
function BudgetsView({events,onOpen}:{events:typeof seedEvents;onOpen:(event:EventRecord)=>void}) { return <ViewShell title="Presupuestos" intro="Versiones, aceptación y trazabilidad de cada propuesta."><Panel title="Presupuestos vigentes"><div className="table-wrap"><table><thead><tr><th>Evento</th><th>Importe actual</th><th>Coste previsto</th><th>Margen</th><th>Estado</th><th></th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td><strong>{e.name}</strong><small>{e.client}</small></td><td>{money(e.amount)}</td><td>{money(e.costs)}</td><td>{e.amount?Math.round((e.amount-e.costs)/e.amount*100):0}%</td><td><Status>{e.status}</Status></td><td><button className="mini" onClick={()=>onOpen(e)}>Abrir versiones</button></td></tr>)}</tbody></table></div></Panel></ViewShell>; }
function PaymentsView({events,onOpen}:{events:typeof seedEvents;onOpen:(event:EventRecord)=>void}) { return <ViewShell title="Anticipos y vencimientos" intro="Control de cobros previstos, recibidos y pendientes."><div className="summary-strip"><div><small>Total contratado</small><strong>{money(events.reduce((a,e)=>a+e.amount,0))}</strong></div><div><small>Cobrado</small><strong>{money(events.reduce((a,e)=>a+e.paid,0))}</strong></div><div><small>Pendiente</small><strong>{money(events.reduce((a,e)=>a+e.amount-e.paid,0))}</strong></div></div><Panel title="Plan de cobros"><div className="payment-list">{events.map(e=><div key={e.id}><div><strong>{e.name}</strong><small>{e.venue} · {e.date}</small></div><div><b>{money(e.paid)} / {money(e.amount)}</b><span className="progress"><i style={{width:`${Math.min(100,e.amount?e.paid/e.amount*100:0)}%`}}/></span></div><button className="mini" onClick={()=>onOpen(e)}>Gestionar cobros</button></div>)}</div></Panel></ViewShell>; }
function TasksView({tasks,setTasks,notify}:{tasks:TaskRecord[];setTasks:React.Dispatch<React.SetStateAction<TaskRecord[]>>;notify:(message:string)=>void}) { async function toggle(task:TaskRecord){const done=!Boolean(task.done);try{const response=await fetch(`/api/tasks/${task.id}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({done})});if(!response.ok)throw new Error();setTasks(current=>current.map(item=>item.id===task.id?{...item,done}:item))}catch{notify("No se pudo actualizar la tarea")}}return <ViewShell title="Tareas" intro="Responsables, fechas límite y prioridades operativas."><div className="task-board">{["Pendientes","Completadas"].map(col=><Panel key={col} title={col}><div className="tasks">{tasks.filter(t=>Boolean(t.done)===(col==="Completadas")).map(t=><button key={t.id} onClick={()=>void toggle(t)}><span className={t.done?"check done":"check"}>{t.done?"✓":""}</span><div><strong>{t.title}</strong><small>{t.event}</small><em>{t.owner} · {t.due}</em></div><Status>{priorityLabel(t.priority)}</Status></button>)}{!tasks.some(t=>Boolean(t.done)===(col==="Completadas"))&&<p className="list-empty">No hay tareas en este estado.</p>}</div></Panel>)}</div></ViewShell>; }
function OrdersView({events,onOpen}:{events:typeof seedEvents;onOpen:(event:EventRecord)=>void}) { return <ViewShell title="Órdenes de servicio" intro="Instrucciones coordinadas para hostess, sala, cocina, montaje y proveedores externos."><div className="orders">{events.map(e=><article key={e.id}><div className="order-top"><span>EV-{String(e.id).padStart(5,"0")}</span><Status>{e.status}</Status></div><h3>{e.name}</h3><p>{e.date} · {e.pax} pax · {e.venue}</p><div className="departments"><span>Hostess</span><span>Sala</span><span>Cocina</span><span>Montaje</span><span>Proveedores</span></div><button onClick={()=>onOpen(e)}>Abrir órdenes ›</button></article>)}</div></ViewShell>; }
function ClosuresView({events,onOpen}:{events:typeof seedEvents;onOpen:(event:EventRecord)=>void}) { return <ViewShell title="Cierres y rentabilidad" intro="Resultado real, desviaciones y aprendizaje por evento."><Panel title="Resultado por evento"><div className="table-wrap"><table><thead><tr><th>Evento</th><th>Ingresos</th><th>Coste previsto</th><th>Resultado</th><th>Margen</th><th></th></tr></thead><tbody>{events.map(e=>{const result=e.amount-e.costs;return <tr key={e.id}><td><strong>{e.name}</strong><small>{e.venue}</small></td><td>{money(e.amount)}</td><td>{money(e.costs)}</td><td className={result>=0?"positive":"danger"}>{money(result)}</td><td>{e.amount?Math.round(result/e.amount*100):0}%</td><td><button className="mini" onClick={()=>onOpen(e)}>Abrir cierre</button></td></tr>})}</tbody></table></div></Panel></ViewShell>; }
