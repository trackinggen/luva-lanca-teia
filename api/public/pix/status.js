import {configured,getCharge,handleError,canonicalReference} from '../../../lib/paguex.mjs';
import {trackingReady,readTracking,sendTracking,utmifyStatus} from '../../../lib/utmify.mjs';
export const config={maxDuration:30};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
 if(!configured())return res.status(503).json({error:'payment_gateway_not_configured'});
 const ids=String(req.query.id||'').split(',').filter(Boolean);
 if(ids.length!==1)return res.status(400).json({error:'transaction_id_required'});
 try{
  const charge=await getCharge(ids[0]);let trackingStatus=null;
  if(trackingReady()&&req.query.state){try{
   const context=readTracking(req.query.state),status=utmifyStatus(charge.status);
   if(context.reference!==canonicalReference(charge.reference)||context.amount!==charge.amount)throw Error('tracking_charge_mismatch');
   if(req.query.tracked===status)trackingStatus=status;
   else{const result=await sendTracking(context,charge);if(result.sent)trackingStatus=result.status;}
  }catch{console.error('utmify_status_delivery_failed');}}
  return res.status(200).json({status:String(charge.status||'pending').toLowerCase(),transactionId:charge.id,amount:charge.amount/100,paidAt:charge.paidAt||null,trackingStatus});
 }catch(error){return handleError(res,error);}
}
