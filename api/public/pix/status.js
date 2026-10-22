import {configured,getCharge,handleError} from '../../../lib/paguex.mjs';
export const config={maxDuration:30};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
 if(!configured())return res.status(503).json({error:'payment_gateway_not_configured'});
 const ids=String(req.query.id||'').split(',').filter(Boolean);
 if(ids.length!==1)return res.status(400).json({error:'transaction_id_required'});
 try{
  const charge=await getCharge(ids[0]);
  return res.status(200).json({status:charge.status==='paid'?'paid':String(charge.status||'pending').toLowerCase(),transactionId:charge.id,amount:charge.amount/100,paidAt:charge.paidAt||null});
 }catch(error){return handleError(res,error);}
}
