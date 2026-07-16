import { clearEditorCookie, createEditorCookie, isEditor, privateHeaders, requireSameOrigin, requireSameOriginJson, validAccessCode } from "../../../editor-auth";

export async function GET(request:Request) {
  return Response.json({editor:await isEditor(request)},{headers:privateHeaders});
}

export async function POST(request:Request) {
  try {
    const invalid=requireSameOriginJson(request);
    if(invalid)return invalid;
    const body=(await request.json()) as {code?:string};
    if(!await validAccessCode(String(body.code??"")))return Response.json({error:"Clave de edición incorrecta"},{status:401,headers:privateHeaders});
    return Response.json({editor:true},{headers:{...privateHeaders,"set-cookie":await createEditorCookie()}});
  } catch {
    return Response.json({error:"No se pudo activar la edición"},{status:500,headers:privateHeaders});
  }
}

export async function DELETE(request:Request) {
  const invalid=requireSameOrigin(request);
  if(invalid)return invalid;
  return Response.json({editor:false},{headers:{...privateHeaders,"set-cookie":clearEditorCookie()}});
}
