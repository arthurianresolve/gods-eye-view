import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
registerHooks({load(url,context,nextLoad){
 if(url.endsWith('/scripts/performance/profileRecoveryPageOwnership.mjs')){
  const source=readFileSync(new URL(url),'utf8');
  const marker='  const settleWithin = async (operation) => {';
  const index=source.indexOf(marker);
  if(index<0) throw new Error('mutation target missing');
  const original=`timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);`;
  const tail=source.slice(index);
  if(!tail.includes(original)) throw new Error('deadline target missing');
  return {format:'module',shortCircuit:true,source:source.slice(0,index)+tail.replace(original,original.replace('timeoutMs);','timeoutMs + 1);'))};
 }
 return nextLoad(url,context);
}});