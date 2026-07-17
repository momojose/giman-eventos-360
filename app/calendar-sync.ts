const DEFAULT_MASTER_CALENDAR_ID = "3abe59d71070c5d7fb086808ea0a877ee0b198f3af0383908283fc7968a1dd67@group.calendar.google.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const APP_URL = "https://giman-eventos-360.momojose.chatgpt.site";

export type CalendarTargetStatus = "not_configured" | "pending" | "syncing" | "synced" | "error";
export type CalendarStatusName = "not_configured" | "pending" | "syncing" | "synced" | "partial" | "error";

export type CalendarTargetView = {
  key: "master" | "venue";
  label: string;
  status: CalendarTargetStatus;
  htmlLink?: string;
  syncedAt?: string | null;
  error?: string | null;
};

export type CalendarView = {
  status: CalendarStatusName;
  dirty: boolean;
  syncedAt: string | null;
  error: string | null;
  targets: CalendarTargetView[];
};

type EventSource = {
  id: number;
  name: string;
  venue: string;
  venueCalendarId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  endDate: string | null;
  timezone: string;
  pax: number;
  status: string;
  calendarDirty: number | boolean;
  calendarRevision: number;
  interviewPayload: string | null;
};

type CalendarLink = {
  targetKind: "master" | "venue";
  targetCalendarId: string;
  googleEventId: string | null;
  googleEtag: string | null;
  lastPayloadHash: string | null;
  syncState: string;
  lastError: string | null;
  syncedAt: string | null;
};

type CalendarTarget = {
  key: "master" | "venue";
  label: string;
  calendarId: string | null;
};

type RuntimeConfig = {
  email: string;
  privateKeyBase64: string;
  masterCalendarId: string;
  configured: boolean;
};

type GoogleEvent = { id?: string; etag?: string; htmlLink?: string };

class CalendarSyncError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
  }
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function runtimeValue(env:unknown,key:string) {
  return String((env as Record<string,unknown>)[key] ?? "").trim();
}

async function runtime() {
  const { env } = await import("cloudflare:workers");
  const email=runtimeValue(env,"GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyBase64=runtimeValue(env,"GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64");
  const masterCalendarId=runtimeValue(env,"GOOGLE_CALENDAR_MASTER_ID") || DEFAULT_MASTER_CALENDAR_ID;
  return {
    db:env.DB,
    config:{email,privateKeyBase64,masterCalendarId,configured:Boolean(email&&privateKeyBase64&&masterCalendarId)} satisfies RuntimeConfig,
  };
}

function base64Url(bytes:Uint8Array) {
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}

function base64UrlText(value:string) {
  return base64Url(new TextEncoder().encode(value));
}

function decodeBase64(value:string) {
  const normalized=value.replaceAll("-","+").replaceAll("_","/").replace(/\s/g,"");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const binary=atob(padded),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function privateKeyDer(value:string) {
  let candidate=value.trim();
  if(!candidate.includes("BEGIN PRIVATE KEY")){
    const decoded=decodeBase64(candidate);
    const decodedText=new TextDecoder().decode(decoded);
    if(decodedText.includes("BEGIN PRIVATE KEY"))candidate=decodedText;
    else return decoded;
  }
  const body=candidate.replace(/-----BEGIN PRIVATE KEY-----/g,"").replace(/-----END PRIVATE KEY-----/g,"").replace(/\s/g,"");
  if(!body)throw new CalendarSyncError("auth_error","La clave privada de Google no es válida");
  return decodeBase64(body);
}

async function sha256Hex(value:string) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function accessToken(config:RuntimeConfig,refresh=false) {
  if(!config.configured)throw new CalendarSyncError("not_configured","La conexión con Google Calendar no está configurada");
  if(!refresh&&tokenCache&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.accessToken;
  const now=Math.floor(Date.now()/1000);
  const header=base64UrlText(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claims=base64UrlText(JSON.stringify({iss:config.email,scope:GOOGLE_SCOPE,aud:GOOGLE_TOKEN_URL,iat:now,exp:now+3600}));
  const signingInput=`${header}.${claims}`;
  let key:CryptoKey;
  try{
    key=await crypto.subtle.importKey("pkcs8",privateKeyDer(config.privateKeyBase64),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  }catch{
    throw new CalendarSyncError("auth_error","La credencial privada de Google no es válida");
  }
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(signingInput));
  const assertion=`${signingInput}.${base64Url(new Uint8Array(signature))}`;
  const response=await fetch(GOOGLE_TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const body=await response.json().catch(()=>({})) as {access_token?:string;expires_in?:number};
  if(!response.ok||!body.access_token)throw new CalendarSyncError("auth_error","Google ha rechazado la credencial de sincronización");
  tokenCache={accessToken:body.access_token,expiresAt:Date.now()+Math.max(300,Number(body.expires_in??3600)-60)*1000};
  return tokenCache.accessToken;
}

function delay(milliseconds:number) {
  return new Promise(resolve=>setTimeout(resolve,milliseconds));
}

async function googleRequest(config:RuntimeConfig,path:string,init:RequestInit={},attempt=0):Promise<{status:number;body:GoogleEvent}> {
  const token=await accessToken(config,attempt>0&&attempt===1);
  let response:Response;
  try{
    response=await fetch(`${GOOGLE_CALENDAR_API}${path}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers??{})}});
  }catch{
    if(attempt<2){await delay(250*2**attempt);return googleRequest(config,path,init,attempt+1)}
    throw new CalendarSyncError("network_error","No se pudo contactar con Google Calendar",true);
  }
  const body=await response.json().catch(()=>({})) as GoogleEvent;
  if(response.ok||[404,409,412].includes(response.status))return {status:response.status,body};
  if(response.status===401&&attempt<1){tokenCache=null;return googleRequest(config,path,init,attempt+1)}
  if((response.status===429||response.status>=500)&&attempt<2){await delay(300*2**attempt);return googleRequest(config,path,init,attempt+1)}
  if(response.status===403)throw new CalendarSyncError("permission_denied","Google Calendar no ha concedido permiso de edición para este calendario");
  if(response.status===429)throw new CalendarSyncError("rate_limited","Google Calendar está temporalmente ocupado; inténtalo de nuevo",true);
  throw new CalendarSyncError("google_error",`Google Calendar devolvió un error (${response.status})`,response.status>=500);
}

const SPANISH_MONTHS:Record<string,number>={
  ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,
  jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,
  oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12,
};

function checkedDate(year:number,month:number,day:number) {
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

export function normalizeEventDate(value:string|null|undefined) {
  const raw=String(value??"").trim();
  let match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(match)return checkedDate(Number(match[1]),Number(match[2]),Number(match[3]));
  match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(match)return checkedDate(Number(match[3]),Number(match[2]),Number(match[1]));
  const normalized=raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[,.-]/g," ").replace(/\bde\b/g," ").replace(/\s+/g," ").trim();
  match=normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if(match&&SPANISH_MONTHS[match[2]])return checkedDate(Number(match[3]),SPANISH_MONTHS[match[2]],Number(match[1]));
  return null;
}

function validTime(value:string|null|undefined) {
  return Boolean(value&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function addDays(value:string,days:number) {
  const date=new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function safeInterview(payload:string|null) {
  try{return JSON.parse(payload||"{}") as Record<string,unknown>}catch{return {} as Record<string,unknown>}
}

function safeText(value:unknown,max=160) {
  return String(value??"").replace(/[\r\n]+/g," ").trim().slice(0,max);
}

function calendarTimes(event:EventSource) {
  const eventDate=normalizeEventDate(event.date);
  if(!eventDate)throw new CalendarSyncError("invalid_event",`La fecha \"${safeText(event.date)}\" no tiene un formato reconocido`);
  const normalizedEndDate=normalizeEventDate(event.endDate);
  if(event.endDate&&!normalizedEndDate)throw new CalendarSyncError("invalid_event",`La fecha final \"${safeText(event.endDate)}\" no tiene un formato reconocido`);
  if(normalizedEndDate&&normalizedEndDate<eventDate)throw new CalendarSyncError("invalid_event","La fecha final no puede ser anterior a la fecha del evento");
  if(validTime(event.startTime)&&validTime(event.endTime)){
    if(normalizedEndDate===eventDate&&String(event.endTime)<=String(event.startTime))throw new CalendarSyncError("invalid_event","La hora final debe ser posterior o usar la fecha del día siguiente");
    const crossesMidnight=!event.endDate&&String(event.endTime)<=String(event.startTime);
    const finalEndDate=normalizedEndDate??(crossesMidnight?addDays(eventDate,1):eventDate);
    return {
      start:{dateTime:`${eventDate}T${event.startTime}:00`,timeZone:event.timezone||"Europe/Madrid"},
      end:{dateTime:`${finalEndDate}T${event.endTime}:00`,timeZone:event.timezone||"Europe/Madrid"},
    };
  }
  const inclusiveEndDate=normalizedEndDate??eventDate;
  return {start:{date:eventDate},end:{date:addDays(inclusiveEndDate,1)}};
}

function eventTitle(event:EventSource,interview:Record<string,unknown>) {
  const reference=`EV-${String(event.id).padStart(5,"0")}`;
  const name=safeText(event.name,100)||safeText(interview.tipo)||"Evento";
  const normalized=event.status.toLowerCase();
  const prefix=normalized==="cancelado"?"CANCELADO · ":["lead","entrevista","presupuesto","pendiente anticipo"].includes(normalized)?"OPCIÓN · ":"";
  return `${prefix}${reference} · ${name} · ${event.venue}`;
}

function googlePayload(event:EventSource,target:CalendarTarget) {
  const interview=safeInterview(event.interviewPayload),times=calendarTimes(event);
  const lines=[
    `Expediente EV-${String(event.id).padStart(5,"0")}`,
    `Estado: ${safeText(event.status)}`,
    `Local: ${safeText(event.venue)}`,
    `Asistentes previstos: ${Math.max(0,Number(event.pax)||0)}`,
  ];
  const space=safeText(interview.espacio);
  if(space)lines.push(`Espacio: ${space}`);
  const operationalTimes:[string,unknown][]=[
    ["Montaje",interview.hora_montaje],
    ["Anfitriones",interview.hora_anfitriones],
    ["Invitados",interview.hora_invitados],
    ["Servicio",interview.hora_servicio],
    ["Final previsto",interview.hora_final],
  ];
  for(const [label,value] of operationalTimes){const time=safeText(value,5);if(validTime(time))lines.push(`${label}: ${time}`)}
  lines.push("",`Gestionar en Giman Eventos 360: ${APP_URL}`,"Este registro se actualiza desde el panel; evita editarlo directamente en Calendar.");
  const normalized=event.status.toLowerCase();
  return {
    summary:eventTitle(event,interview),
    description:lines.join("\n"),
    location:safeText(event.venue),
    ...times,
    transparency:["confirmado","operativa"].includes(normalized)?"opaque":"transparent",
    visibility:"private",
    guestsCanInviteOthers:false,
    guestsCanModify:false,
    guestsCanSeeOtherGuests:false,
    extendedProperties:{private:{source:"giman-eventos-360",gimanEventId:String(event.id),target:target.key,revision:String(event.calendarRevision)}},
  };
}

async function deterministicEventId(eventId:number,target:CalendarTarget) {
  const digest=await sha256Hex(`giman-eventos-360:${eventId}:${target.key}:${target.calendarId}`);
  return `giman360${digest.slice(0,40)}`;
}

function eventLink(calendarId:string,eventId:string) {
  const eid=btoa(`${eventId} ${calendarId}`).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  return `https://calendar.google.com/calendar/event?eid=${eid}`;
}

async function loadEvent(db:D1Database,eventId:number) {
  return db.prepare(`
    SELECT e.id,e.name,v.name AS venue,v.google_calendar_id AS venueCalendarId,
           e.event_date AS date,e.start_time AS startTime,e.end_time AS endTime,e.end_date AS endDate,
           e.timezone,e.guests AS pax,e.status,e.calendar_dirty AS calendarDirty,
           e.calendar_revision AS calendarRevision,ei.payload AS interviewPayload
    FROM events e
    JOIN venues v ON v.id=e.venue_id
    LEFT JOIN event_interviews ei ON ei.event_id=e.id
    WHERE e.id=?
  `).bind(eventId).first<EventSource>();
}

async function loadLinks(db:D1Database,eventId:number) {
  const result=await db.prepare(`
    SELECT target_kind AS targetKind,target_calendar_id AS targetCalendarId,
           google_event_id AS googleEventId,google_etag AS googleEtag,
           last_payload_hash AS lastPayloadHash,sync_state AS syncState,
           last_error AS lastError,synced_at AS syncedAt
    FROM event_calendar_syncs WHERE event_id=?
  `).bind(eventId).all<CalendarLink>();
  return result.results;
}

function targets(event:EventSource,config:RuntimeConfig):CalendarTarget[] {
  return [
    {key:"master",label:"Eventos Maestro · Grupo Giman",calendarId:config.masterCalendarId||null},
    {key:"venue",label:`Eventos ${event.venue}`,calendarId:event.venueCalendarId||null},
  ];
}

function aggregate(dirty:boolean,targetViews:CalendarTargetView[],configured:boolean):CalendarView {
  const successful=targetViews.filter(target=>target.status==="synced");
  const failed=targetViews.filter(target=>target.status==="error");
  const missing=targetViews.filter(target=>target.status==="not_configured");
  const syncing=targetViews.some(target=>target.status==="syncing");
  let status:CalendarStatusName;
  if(!configured)status="not_configured";
  else if(syncing)status="syncing";
  else if(successful.length===targetViews.length&&!dirty)status="synced";
  else if(successful.length>0&&(failed.length>0||missing.length>0))status="partial";
  else if(failed.length>0&&successful.length===0)status="error";
  else status="pending";
  const dates=successful.map(target=>target.syncedAt).filter((value):value is string=>Boolean(value)).sort();
  const errors=[...failed,...missing].map(target=>target.error).filter((value):value is string=>Boolean(value));
  return {status,dirty,syncedAt:dates.at(-1)??null,error:errors.length?errors.join(" · "):null,targets:targetViews};
}

function viewFromLink(target:CalendarTarget,link:CalendarLink|undefined,dirty:boolean,configured:boolean):CalendarTargetView {
  if(!configured)return {key:target.key,label:target.label,status:"not_configured",error:"La conexión con Google Calendar no está configurada"};
  if(!target.calendarId)return {key:target.key,label:target.label,status:"not_configured",error:`No hay calendario configurado para ${target.label}`};
  const targetMatches=link?.targetCalendarId===target.calendarId;
  const state=targetMatches?link?.syncState:undefined;
  const status:CalendarTargetStatus=state==="error"?"error":state==="syncing"?"syncing":state==="synced"&&!dirty?"synced":"pending";
  return {
    key:target.key,label:target.label,status,
    htmlLink:targetMatches&&link?.googleEventId?eventLink(target.calendarId,link.googleEventId):undefined,
    syncedAt:targetMatches?link?.syncedAt??null:null,error:status==="error"?link?.lastError??"No se pudo sincronizar":null,
  };
}

async function deleteOldTarget(config:RuntimeConfig,link:CalendarLink,target:CalendarTarget) {
  if(!link.googleEventId||link.targetCalendarId===target.calendarId)return;
  const path=`/calendars/${encodeURIComponent(link.targetCalendarId)}/events/${encodeURIComponent(link.googleEventId)}?sendUpdates=none`;
  const result=await googleRequest(config,path,{method:"DELETE"});
  if(result.status!==204&&result.status!==404)throw new CalendarSyncError("google_error","No se pudo retirar el evento del calendario anterior");
}

async function saveSyncing(db:D1Database,eventId:number,target:CalendarTarget,googleEventId:string) {
  await db.prepare(`
    INSERT INTO event_calendar_syncs
      (event_id,target_kind,target_calendar_id,google_event_id,sync_state,attempt_count,last_attempt_at,updated_at)
    VALUES (?,?,?,?,'syncing',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(event_id,target_kind) DO UPDATE SET
      target_calendar_id=excluded.target_calendar_id,google_event_id=excluded.google_event_id,
      sync_state='syncing',attempt_count=event_calendar_syncs.attempt_count+1,
      last_error=NULL,last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
  `).bind(eventId,target.key,target.calendarId,googleEventId).run();
}

async function saveSynced(db:D1Database,eventId:number,target:CalendarTarget,eventIdGoogle:string,event:GoogleEvent,payloadHash:string) {
  await db.prepare(`
    UPDATE event_calendar_syncs SET google_event_id=?,google_etag=?,last_payload_hash=?,
      sync_state='synced',last_error=NULL,synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE event_id=? AND target_kind=?
  `).bind(event.id||eventIdGoogle,event.etag||null,payloadHash,eventId,target.key).run();
}

async function saveError(db:D1Database,eventId:number,target:CalendarTarget,error:unknown) {
  const message=(error instanceof Error?error.message:"No se pudo sincronizar").slice(0,300);
  await db.prepare(`
    INSERT INTO event_calendar_syncs
      (event_id,target_kind,target_calendar_id,sync_state,last_error,last_attempt_at,updated_at)
    VALUES (?,?,?,'error',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(event_id,target_kind) DO UPDATE SET
      google_event_id=CASE WHEN event_calendar_syncs.target_calendar_id=excluded.target_calendar_id THEN event_calendar_syncs.google_event_id ELSE NULL END,
      google_etag=CASE WHEN event_calendar_syncs.target_calendar_id=excluded.target_calendar_id THEN event_calendar_syncs.google_etag ELSE NULL END,
      target_calendar_id=excluded.target_calendar_id,sync_state='error',last_error=excluded.last_error,
      last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
  `).bind(eventId,target.key,target.calendarId,message).run();
  return message;
}

async function saveConflict(db:D1Database,config:RuntimeConfig,eventId:number,message:string) {
  const event=await loadEvent(db,eventId);
  if(!event)return;
  for(const target of targets(event,config)){
    if(!target.calendarId)continue;
    await db.prepare(`
      INSERT INTO event_calendar_syncs
        (event_id,target_kind,target_calendar_id,sync_state,last_error,last_attempt_at,updated_at)
      VALUES (?,?,?,'error',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(event_id,target_kind) DO UPDATE SET
        google_event_id=CASE WHEN event_calendar_syncs.target_calendar_id=excluded.target_calendar_id THEN event_calendar_syncs.google_event_id ELSE NULL END,
        google_etag=CASE WHEN event_calendar_syncs.target_calendar_id=excluded.target_calendar_id THEN event_calendar_syncs.google_etag ELSE NULL END,
        target_calendar_id=excluded.target_calendar_id,sync_state='error',last_error=excluded.last_error,
        last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    `).bind(eventId,target.key,target.calendarId,message.slice(0,300)).run();
  }
}

async function upsertGoogleEvent(config:RuntimeConfig,target:CalendarTarget,googleEventId:string,payload:Record<string,unknown>,etag:string|null) {
  const calendar=encodeURIComponent(String(target.calendarId)),event=encodeURIComponent(googleEventId);
  const existing=await googleRequest(config,`/calendars/${calendar}/events/${event}`,{method:"GET"});
  if(existing.status===404){
    const inserted=await googleRequest(config,`/calendars/${calendar}/events?sendUpdates=none`,{method:"POST",body:JSON.stringify({id:googleEventId,...payload})});
    if([200,201].includes(inserted.status))return inserted.body;
    if(inserted.status!==409)throw new CalendarSyncError("google_error",`No se pudo crear ${target.label}`);
  }
  const headers:Record<string,string>={};
  if(etag)headers["if-match"]=etag;
  let updated=await googleRequest(config,`/calendars/${calendar}/events/${event}?sendUpdates=none`,{method:"PUT",headers,body:JSON.stringify(payload)});
  if(updated.status===412)updated=await googleRequest(config,`/calendars/${calendar}/events/${event}?sendUpdates=none`,{method:"PUT",body:JSON.stringify(payload)});
  if(![200,201].includes(updated.status))throw new CalendarSyncError("google_error",`No se pudo actualizar ${target.label}`);
  return updated.body;
}

async function syncTarget(db:D1Database,config:RuntimeConfig,event:EventSource,target:CalendarTarget,link:CalendarLink|undefined,dryRun:boolean):Promise<CalendarTargetView> {
  if(!config.configured)return viewFromLink(target,link,true,false);
  if(!target.calendarId)return viewFromLink(target,link,true,true);
  let payload:ReturnType<typeof googlePayload>;
  try{payload=googlePayload(event,target)}catch(error){
    const message=dryRun?(error instanceof Error?error.message:"El evento no tiene una fecha válida"):await saveError(db,event.id,target,error);
    return {key:target.key,label:target.label,status:"error",error:message};
  }
  const payloadHash=await sha256Hex(JSON.stringify(payload));
  if(dryRun)return {key:target.key,label:target.label,status:"pending",syncedAt:link?.syncedAt??null,error:null};
  let googleEventId=link?.targetCalendarId===target.calendarId&&link.googleEventId?link.googleEventId:await deterministicEventId(event.id,target);
  try{
    if(link)await deleteOldTarget(config,link,target);
    await saveSyncing(db,event.id,target,googleEventId);
    const remote=await upsertGoogleEvent(config,target,googleEventId,payload,link?.targetCalendarId===target.calendarId?link.googleEtag:null);
    googleEventId=remote.id||googleEventId;
    await saveSynced(db,event.id,target,googleEventId,remote,payloadHash);
    return {key:target.key,label:target.label,status:"synced",htmlLink:remote.htmlLink||eventLink(target.calendarId,googleEventId),syncedAt:new Date().toISOString(),error:null};
  }catch(error){
    const message=await saveError(db,event.id,target,error);
    return {key:target.key,label:target.label,status:"error",syncedAt:link?.syncedAt??null,error:message};
  }
}

export async function getEventCalendar(eventId:number):Promise<CalendarView|null> {
  const {db,config}=await runtime(),event=await loadEvent(db,eventId);
  if(!event)return null;
  const links=await loadLinks(db,eventId),dirty=Boolean(event.calendarDirty);
  const views=targets(event,config).map(target=>viewFromLink(target,links.find(link=>link.targetKind===target.key),dirty,config.configured));
  return aggregate(dirty,views,config.configured);
}

export async function syncEventCalendar(eventId:number,{dryRun=false}:{dryRun?:boolean}={}):Promise<CalendarView|null> {
  const {db,config}=await runtime(),event=await loadEvent(db,eventId);
  if(!event)return null;
  const links=await loadLinks(db,eventId),views:CalendarTargetView[]=[],desiredTargets=targets(event,config);
  for(const target of desiredTargets)views.push(await syncTarget(db,config,event,target,links.find(link=>link.targetKind===target.key),dryRun));
  const configuredKeys=new Set(desiredTargets.filter(target=>Boolean(target.calendarId)).map(target=>target.key));
  const allSynced=config.configured&&configuredKeys.size>0&&views.filter(target=>configuredKeys.has(target.key)).every(target=>target.status==="synced");
  let dirty=Boolean(event.calendarDirty);
  if(!dryRun&&allSynced){
    const cleared=await db.prepare("UPDATE events SET calendar_dirty=0 WHERE id=? AND calendar_revision=?").bind(eventId,event.calendarRevision).run();
    dirty=Number(cleared.meta.changes??0)===0;
  }else if(!dryRun){
    await db.prepare("UPDATE events SET calendar_dirty=1 WHERE id=?").bind(eventId).run();
    dirty=true;
  }
  return aggregate(dryRun?Boolean(event.calendarDirty):dirty,views,config.configured);
}

export async function syncDirtyCalendars({dryRun=false,limit=10}:{dryRun?:boolean;limit?:number}={}) {
  const {db,config}=await runtime();
  const safeLimit=Math.max(1,Math.min(20,Math.round(limit)));
  const rows=await db.prepare(`
    SELECT e.id,e.name,v.name AS venue,e.event_date AS date,e.guests AS pax
    FROM events e JOIN venues v ON v.id=e.venue_id
    WHERE e.calendar_dirty=1 ORDER BY e.event_date,e.id LIMIT ?
  `).bind(safeLimit).all<{id:number;name:string;venue:string;date:string;pax:number}>();
  const allRows=await db.prepare(`
    SELECT e.id,e.name,v.name AS venue,e.event_date AS date,e.guests AS pax
    FROM events e JOIN venues v ON v.id=e.venue_id
  `).all<{id:number;name:string;venue:string;date:string;pax:number}>();
  const normalize=(value:string)=>value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const groups=new Map<string,number[]>();
  for(const row of allRows.results){
    const date=normalizeEventDate(row.date);
    if(!date)continue;
    const key=`${normalize(row.name)}|${normalize(row.venue)}|${date}|${Number(row.pax)||0}`;
    groups.set(key,[...(groups.get(key)??[]),Number(row.id)]);
  }
  const conflicts=[...groups.values()].filter(ids=>ids.length>1);
  const conflictedIds=new Set(conflicts.flat());
  const events:Array<{eventId:number;calendar:CalendarView;conflict?:boolean}>=[];
  for(const row of rows.results){
    const eventId=Number(row.id);
    if(conflictedIds.has(eventId)){
      const ids=conflicts.find(group=>group.includes(eventId))??[];
      const message=`Posible duplicado: ${ids.map(id=>`EV-${String(id).padStart(5,"0")}`).join(" y ")}. Revisa las fichas antes de sincronizar.`;
      if(!dryRun)await saveConflict(db,config,eventId,message);
      events.push({eventId,conflict:true,calendar:{status:"error",dirty:true,syncedAt:null,error:message,targets:[{key:"master",label:"Eventos Maestro · Grupo Giman",status:"error",error:message},{key:"venue",label:`Eventos ${row.venue}`,status:"error",error:message}]}});
      continue;
    }
    const calendar=await syncEventCalendar(eventId,{dryRun});if(calendar)events.push({eventId,calendar});
  }
  const synced=events.filter(item=>!item.conflict&&!item.calendar.dirty&&!item.calendar.targets.some(target=>target.status==="error")).length;
  return {processed:events.length,synced,failed:events.length-synced,conflicts:conflicts.map(eventIds=>({eventIds})),events};
}

export function calendarSummarySql(alias="e") {
  return {
    status:`CASE WHEN EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=${alias}.id AND cs.sync_state='error') THEN 'error' WHEN ${alias}.calendar_dirty=1 THEN 'pending' WHEN EXISTS (SELECT 1 FROM event_calendar_syncs cs WHERE cs.event_id=${alias}.id AND cs.sync_state='synced') THEN 'synced' ELSE 'pending' END`,
    syncedAt:`(SELECT MAX(cs.synced_at) FROM event_calendar_syncs cs WHERE cs.event_id=${alias}.id AND cs.sync_state='synced')`,
  };
}
