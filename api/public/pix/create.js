import {configured,parseOrder,createCharge,handleError} from '../../../lib/paguex.mjs';
export const config={maxDuration:30};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
 if(!configured())return res.status(503).json({code:'payment_gateway_not_configured',error:'Pagamento ainda não configurado.'});
 let order;try{order=parseOrder(req.body);}catch(error){return handleError(res,error);}
 // Each POST creates a new charge: never retry automatically after an uncertain outcome.
 try{
  const data=await createCharge(order);
  if(!data.id||!data.pix?.copiaECola||data.amount!==order.amount||data.paymentMethod!=='pix')throw Error('invalid_response');
  return res.status(201).json({copyPaste:data.pix.copiaECola,qrCode:data.pix.qrCodeImageUrl||'',transactionId:data.id,gatewayTransactionId:data.id,orderId:data.id,gateway:'paguex'});
 }catch(error){
  console.error('paguex_create_failed',{code:error?.code||'invalid_response',status:error?.status||502});
  return res.status(502).json({code:'payment_creation_uncertain',error:'Não foi possível confirmar a geração. Confira a cobrança no painel antes de tentar novamente.'});
 }
}
