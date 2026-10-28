import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export function browserSupabase(){if(!url||!key)throw new Error("Supabase не настроен");return createClient(url,key)}
export async function authedSupabase(req:NextRequest){
 if(!url||!key)throw new Error("Supabase не настроен на сервере");const token=req.headers.get("x-locallead-token");if(!token)throw new Error("Нужно войти в приложение");
 const sb=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}}});const {data:{user},error}=await sb.auth.getUser(token);
 if(error||!user)throw new Error("Сессия истекла. Войдите снова.");if(user.email?.toLowerCase()!==process.env.NEXT_PUBLIC_OWNER_EMAIL?.toLowerCase())throw new Error("Этот аккаунт не имеет доступа к LocalLead Finder");return{sb,user};
}
