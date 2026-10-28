export function scoreLead(l:{website?:string|null;phone?:string|null;email?:string|null;category?:string|null;websiteStatus?:string; audit?:{performance?:number;accessibility?:number;seo?:number;https?:boolean}}) {
 let score=35; const why:string[]=[];
 if(!l.website){score+=35;why.push("сайт не указан в OpenStreetMap — нужна ручная проверка");} else if(l.websiteStatus==="weak"){score+=27;why.push("сайт технически слабый");} else {why.push("сайт указан в источнике");}
 if(l.phone){score+=12;why.push("есть телефон для связи");} if(l.email){score+=6;why.push("есть email");}
 if(l.audit){ const a=l.audit; if((a.performance??100)<55){score+=10;why.push("низкая скорость");} if((a.seo??100)<65){score+=8;why.push("слабое SEO");} if(!a.https){score+=9;why.push("нет HTTPS");} }
 if(l.category) score+=3;
 return {score:Math.min(100,score),reason:why.join("; ")};
}
