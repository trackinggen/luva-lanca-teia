import {configured,verifySignature,validReference,normalizeCharge,getCharge,canonicalReference} from '../../../lib/paguex.mjs';
import {trackingReady,readTracking,sendTracking,utmifyStatus} from '../../../lib/utmify.mjs';
// HMAC must use the exact incoming bytes, never reserialized JSON.
export const config={api:{bodyParser:false},maxDuration:30};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
 if(!configured())return res.status(503).json({error:'payment_gateway_not_configured'});
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>65536)return res.status(413).end();chunks.push(chunk);}
 const raw=Buffer.concat(chunks);
 if(!verifySignature(raw,req.headers['x-paguex-signature']))return res.status(401).json({error:'invalid_signature'});
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).json({error:'invalid_json'});}
 if(!event||typeof event.event!=='string'||!event.data?.saleId)return res.status(400).json({error:'invalid_event'});
 const callback=normalizeCharge({...event.data,id:event.data.saleId});
 if(!validReference(callback.reference,callback.amount))return res.status(200).json({received:true,ignored:true});
 if(!trackingReady()||!req.query?.state)return res.status(200).json({received:true,tracking:'not_applicable'});
 let context;
 try{context=readTracking(req.query.state);}catch{return res.status(400).json({error:'invalid_tracking_context'});}
 if(context.reference!==canonicalReference(callback.reference)||context.amount!==callback.amount)return res.status(400).json({error:'tracking_charge_mismatch'});
 try{
  // Confirm the current state; a late pending callback must not downgrade a paid order.
  const charge=await getCharge(callback.id,{timeoutMs:3000});
  const result=await sendTracking(context,charge,{customer:callback.customer||charge.customer,eventTime:utmifyStatus(callback.status)===utmifyStatus(charge.status)?event.createdAt:undefined});
  if(!result.sent)return res.status(200).json({received:true,tracking:'unsupported_or_missing_data'});
  return res.status(200).json({received:true,tracking:result.status});
 }catch{console.error('utmify_webhook_delivery_failed');return res.status(502).json({error:'tracking_delivery_failed'});}
}
