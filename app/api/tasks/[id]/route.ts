import { privateHeaders, requireEditor, requireSameOriginJson } from "../../../editor-auth";

async function database(){const {env}=await import("cloudflare:workers");return env.DB}
type Context={params:Promise<{id:string}>};

export async function PUT(request:Request,context:Context){
  try{
    const denied=await requireEditor(request);
    if(denied)return denied;
    const invalid=requireSameOriginJson(request);
    if(invalid)return invalid;
    const {id}=await context.params,taskId=Number(id),body=(await request.json()) as {done?:boolean};
    if(!Number.isInteger(taskId)||taskId<1)return Response.json({error:"Tarea no válida"},{status:400});
    const db=await database();
    const result=await db.prepare("UPDATE tasks SET completed=? WHERE id=?").bind(body.done?1:0,taskId).run();
    if(!result.meta.changes)return Response.json({error:"Tarea no encontrada"},{status:404});
    return Response.json({saved:true});
  }catch{return Response.json({error:"No se pudo actualizar la tarea"},{status:500,headers:privateHeaders})}
}
