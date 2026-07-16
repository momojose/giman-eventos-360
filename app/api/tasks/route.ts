async function database(){const {env}=await import("cloudflare:workers");return env.DB}

export async function GET(){
  try{
    const db=await database();
    const result=await db.prepare(`SELECT t.id,t.title,e.name AS event,t.owner,COALESCE(t.due_date,'Sin fecha') AS due,t.priority,t.completed AS done FROM tasks t JOIN events e ON e.id=t.event_id ORDER BY t.completed,t.due_date,t.id`).all();
    return Response.json({tasks:result.results});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudieron cargar las tareas"},{status:500})}
}
