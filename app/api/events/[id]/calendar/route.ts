import { getEventCalendar, syncEventCalendar } from "../../../../calendar-sync";
import { privateHeaders, requireEditor, requireSameOriginJson } from "../../../../editor-auth";

type Context={params:Promise<{id:string}>};

function eventId(value:string) {
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

export async function GET(request:Request,context:Context) {
  try{
    const denied=await requireEditor(request);if(denied)return denied;
    const {id:value}=await context.params,id=eventId(value);
    if(!id)return Response.json({error:"Evento no válido"},{status:400,headers:privateHeaders});
    const calendar=await getEventCalendar(id);
    if(!calendar)return Response.json({error:"Evento no encontrado"},{status:404,headers:privateHeaders});
    return Response.json({calendar},{headers:privateHeaders});
  }catch{
    return Response.json({error:"No se pudo consultar la sincronización con Calendar"},{status:500,headers:privateHeaders});
  }
}

export async function POST(request:Request,context:Context) {
  try{
    const denied=await requireEditor(request);if(denied)return denied;
    const invalid=requireSameOriginJson(request);if(invalid)return invalid;
    const {id:value}=await context.params,id=eventId(value);
    if(!id)return Response.json({error:"Evento no válido"},{status:400,headers:privateHeaders});
    await request.json().catch(()=>({}));
    const calendar=await syncEventCalendar(id);
    if(!calendar)return Response.json({error:"Evento no encontrado"},{status:404,headers:privateHeaders});
    return Response.json({calendar},{headers:privateHeaders});
  }catch{
    return Response.json({error:"No se pudo sincronizar el evento con Calendar"},{status:500,headers:privateHeaders});
  }
}
