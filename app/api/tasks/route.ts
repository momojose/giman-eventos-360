import { isEditor, privateEventName, privateHeaders } from "../../editor-auth";

async function database(){const {env}=await import("cloudflare:workers");return env.DB}

export async function GET(request:Request){
  try{
    const db=await database();
    const result=await db.prepare(`SELECT t.id,t.title,e.id AS eventId,e.name AS event,t.owner,COALESCE(t.due_date,'Sin fecha') AS due,t.priority,t.completed AS done FROM tasks t JOIN events e ON e.id=t.event_id ORDER BY t.completed,t.due_date,t.id`).all();
    const editor=await isEditor(request);
    const tasks=(result.results as Array<Record<string,unknown>&{id:number;eventId:number;due:unknown;priority:unknown;done:unknown}>).map(task=>editor?task:{id:task.id,title:"Tarea operativa",eventId:task.eventId,event:privateEventName(task.eventId),owner:"Equipo Giman",due:task.due,priority:task.priority,done:task.done});
    return Response.json({tasks,editor},{headers:privateHeaders});
  }catch{return Response.json({error:"No se pudieron cargar las tareas"},{status:500,headers:privateHeaders})}
}
