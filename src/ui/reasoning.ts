type Item=Record<string,any>;
export function reasoningText(item:Item){
 const value=item.summary?.length?item.summary:item.text??item.content??'';
 const text=Array.isArray(value)?value.map(part=>typeof part==='string'?part:part?.text??'').join('\n\n'):String(value);
 return text.replace(/(\*\*[^*\n]+\*\*)(?=\*\*[^*\n])/g,'$1\n\n');
}
export function appendReasoningDelta(item:Item,method:string,params:Item){
 const summary=method.includes('summaryTextDelta'),field=summary?'summary':'content';
 const index=Number(summary?params.summaryIndex??0:params.contentIndex??0);
 if(!Number.isInteger(index)||index<0||index>10000)return;
 const parts=Array.isArray(item[field])?[...item[field]]:[];
 const previous=parts[index];parts[index]=(typeof previous==='string'?previous:previous?.text??'')+(params.delta??'');
 item[field]=parts;item.text=parts.map(part=>typeof part==='string'?part:part?.text??'').join('\n\n');
}
