import { syncDirtyCalendars } from "../../../calendar-sync";
import { privateHeaders, requireEditor, requireSameOriginJson } from "../../../editor-auth";

export async function POST(request:Request) {
  try{
    const denied=await requireEditor(request);if(denied)return denied;
    const invalid=requireSameOriginJson(request);if(invalid)return invalid;
    const body=await request.json().catch(()=>({})) as {scope?:string;dryRun?:boolean};
    if(body.scope!=="dirty")return Response.json({error:"El alcance de sincronización no es válido"},{status:400,headers:privateHeaders});
    const result=await syncDirtyCalendars({dryRun:body.dryRun===true});
    return Response.json({...result,summary:{processed:result.processed,synced:result.synced,failed:result.failed}},{headers:privateHeaders});
  }catch{
    return Response.json({error:"No se pudo actualizar Calendar"},{status:500,headers:privateHeaders});
  }
}
