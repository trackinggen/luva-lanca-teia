import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {canonicalReference,validReference} from './paguex.mjs';
const CALLBACK='https://luva-lanca-teia.vercel.app/api/public/pix/webhook/';
const MAX_STATE=1800,MAX_AGE=30*864e5,AAD=Buffer.from('paguex-utmify-v1');
export function trackingReady(){return !!(process.env.UTMIFY_API_TOKEN&&process.env.UTMIFY_STATE_SECRET);}
function key(){if(!process.env.UTMIFY_STATE_SECRET)throw Error('tracking_not_configured');return createHash('sha256').update(process.env.UTMIFY_STATE_SECRET).digest();}
export function prepareTracking(body,order,reference){
 const trackingParameters={},source=body.utm||{};
 for(const name of ['src','sck','utm_source','utm_campaign','utm_medium','utm_content','utm_term']){const value=source[name]??source[name.replace('utm_','')];trackingParameters[name]=typeof value==='string'&&value.trim()?value.trim().slice(0,2000):null;}
 const context={reference,amount:order.amount,createdAt:new Date().toISOString(),products:order.items,trackingParameters};
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(AAD);
 const encrypted=Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(context)))),cipher.final()]);
 const token='v1.'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
 if(token.length>MAX_STATE)throw Error('tracking_context_too_large');
 const url=new URL(CALLBACK);url.searchParams.set('state',token);
 return {token,context,callbackUrl:url.href};
}
export function readTracking(token){
 if(typeof token!=='string'||token.length>MAX_STATE||!/^v1\.[A-Za-z0-9_-]+$/.test(token))throw Error('invalid_tracking_context');
 const raw=Buffer.from(token.slice(3),'base64url');if(raw.length<29)throw Error('invalid_tracking_context');
 const decipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));decipher.setAAD(AAD);decipher.setAuthTag(raw.subarray(12,28));
 const decrypted=Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]);
 const context=JSON.parse(inflateRawSync(decrypted,{maxOutputLength:32768}).toString('utf8'));
 const created=Date.parse(context.createdAt);
 if(!Number.isFinite(created)||created>Date.now()+60000||created<Date.now()-MAX_AGE||!validReference(context.reference,context.amount)||!Array.isArray(context.products)||!context.products.length)throw Error('invalid_tracking_context');
 return context;
}
export function utmifyStatus(status){return ({pending:'waiting_payment',authorized:'waiting_payment',paid:'paid',refused:'refused',canceled:'refused',expired:'refused',refunded:'refunded',chargeback:'chargedback'})[String(status||'').toLowerCase()]||null;}
function utc(value){if(value==null)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString().slice(0,19).replace('T',' '):null;}
export async function sendTracking(context,charge,{customer=charge.customer,eventTime}={}){
 if(!trackingReady())return {sent:false,status:null};
 const status=utmifyStatus(charge.status);
 if(!status)return {sent:false,status:null};
 if(!charge.id||charge.paymentMethod!=='pix'||charge.amount!==context.amount||canonicalReference(charge.reference)!==context.reference)throw Error('tracking_charge_mismatch');
 if(!customer?.name||!customer?.email)return {sent:false,status:null};
 const approved=status==='paid'?utc(charge.paidAt)||utc(eventTime)||utc(charge.updatedAt)||utc(Date.now()):utc(charge.paidAt);
 const refunded=['refunded','chargedback'].includes(status)?utc(charge.refundedAt)||utc(eventTime)||utc(Date.now()):null;
 const payload={orderId:charge.id,platform:'Pague-X',paymentMethod:'pix',status,createdAt:utc(context.createdAt),approvedDate:approved,refundedAt:refunded,customer:{name:customer.name,email:customer.email,phone:customer.phone||null,document:null,country:'BR'},products:context.products.map(p=>({...p,planId:null,planName:null})),trackingParameters:context.trackingParameters,commission:{totalPriceInCents:context.amount,gatewayFeeInCents:0,userCommissionInCents:context.amount},isTest:false};
 const response=await fetch('https://api.utmify.com.br/api-credentials/orders',{method:'POST',headers:{'Content-Type':'application/json','x-api-token':process.env.UTMIFY_API_TOKEN},body:JSON.stringify(payload),signal:AbortSignal.timeout(4000)});
 const result=await response.json().catch(()=>null);
 if(!response.ok||result?.OK===false||result?.result==='ERROR'){console.error('utmify_delivery_failed',{status:response.status});throw Error('utmify_delivery_failed');}
 return {sent:true,status};
}
