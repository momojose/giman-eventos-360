const COOKIE_NAME = "giman_editor_session";
const SESSION_SECONDS = 12 * 60 * 60;

export const privateHeaders = {
  "cache-control": "private, no-store",
  "vary": "Cookie",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

async function secrets() {
  const { env } = await import("cloudflare:workers");
  return {
    accessCodeHash: String(env.EDITOR_ACCESS_CODE_SHA256 ?? "").toLowerCase(),
    sessionSecret: String(env.EDITOR_SESSION_SECRET ?? ""),
  };
}

function bytesToBase64Url(bytes:Uint8Array) {
  let binary="";
  for (const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}

async function signature(expires:string,secret:string) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const result=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`giman-editor:${expires}`));
  return bytesToBase64Url(new Uint8Array(result));
}

function safeEqual(left:string,right:string) {
  if(left.length!==right.length)return false;
  let difference=0;
  for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index)^right.charCodeAt(index);
  return difference===0;
}

async function sha256(value:string) {
  const result=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result),byte=>byte.toString(16).padStart(2,"0")).join("");
}

function cookieValue(request:Request) {
  const cookie=request.headers.get("cookie")??"";
  for(const part of cookie.split(";")){
    const [name,...value]=part.trim().split("=");
    if(name===COOKIE_NAME)return value.join("=");
  }
  return "";
}

export async function isEditor(request:Request) {
  const token=cookieValue(request);
  if(!token)return false;
  const [expires,provided]=token.split(".",2),timestamp=Number(expires);
  if(!expires||!provided||!Number.isFinite(timestamp)||timestamp<Date.now())return false;
  const {sessionSecret}=await secrets();
  if(!sessionSecret)return false;
  return safeEqual(provided,await signature(expires,sessionSecret));
}

export async function validAccessCode(code:string) {
  const {accessCodeHash}=await secrets();
  return accessCodeHash.length===64&&safeEqual(await sha256(code),accessCodeHash);
}

export async function createEditorCookie() {
  const {sessionSecret}=await secrets();
  if(!sessionSecret)throw new Error("La edición protegida no está configurada");
  const expiresAt=Date.now()+SESSION_SECONDS*1000,expires=String(expiresAt),token=`${expires}.${await signature(expires,sessionSecret)}`;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearEditorCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function requireEditor(request:Request) {
  if(await isEditor(request))return null;
  return Response.json({error:"Activa el modo edición para guardar cambios"},{status:401,headers:privateHeaders});
}

export function requireSameOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"Origen no permitido"},{status:403,headers:privateHeaders});
  return null;
}

export function requireSameOriginJson(request:Request) {
  const invalidOrigin=requireSameOrigin(request);
  if(invalidOrigin)return invalidOrigin;
  if(!(request.headers.get("content-type")??"").toLowerCase().startsWith("application/json"))return Response.json({error:"Se requiere contenido JSON"},{status:415,headers:privateHeaders});
  return null;
}

export function privateEventName(id:number) {
  return `Evento EV-${String(id).padStart(5,"0")}`;
}
