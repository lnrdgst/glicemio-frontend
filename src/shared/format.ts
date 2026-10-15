export const localInput=(iso?:string)=>{const d=iso?new Date(iso):new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
export const iso=(v:string)=>{
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new Error('Informe uma data e um horário válidos.')
 const d = new Date(v)
 if (!Number.isFinite(d.getTime()) || localInput(d.toISOString()) !== v) throw new Error('Informe uma data e um horário válidos.')
 return d.toISOString()
}
export const dateTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))
export const time=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
export const relative=(v:string)=>{const m=Math.round((Date.now()-new Date(v).getTime())/60000); if(m<1)return 'agora'; if(m<60)return `há ${m} min`; if(m<1440)return `há ${Math.floor(m/60)}h${m%60?`${m%60}`:''}`;return dateTime(v)}
export const duration=(a:string,b?:string)=>!b?'Em andamento':`${Math.round((new Date(b).getTime()-new Date(a).getTime())/60000)} min`
