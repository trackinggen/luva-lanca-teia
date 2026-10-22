import {configured,parseOrder,createCharge,handleError,makeReference} from '../../../lib/paguex.mjs';
import {trackingReady,prepareTracking,sendTracking} from '../../../lib/utmify.mjs';
export const config={maxDuration:45};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
 if(!configured())return res.status(503).json({code:'payment_gateway_not_configured',error:'Pagamento ainda não configurado.'});
 let order;try{order=parseOrder(req.body);}catch(error){return handleError(res,error);}
 const reference=makeReference(order.amount);let tracking=null;
 if(process.env.UTMIFY_API_TOKEN){
  if(!trackingReady())return res.status(503).json({code:'tracking_not_configured',error:'Pagamento ainda não configurado.'});
  try{tracking=prepareTracking(req.body,order,reference);}catch{return res.status(400).json({code:'invalid_tracking_context',error:'Não foi possível preparar o pedido. Atualize a página e tente novamente.'});}
 }
 let data;
 try{
  // Pague-X creates a new charge for every POST: never automatically retry it.
  data=await createCharge(order,{reference,...(tracking?{postbackUrl:tracking.callbackUrl}:{})});
  if(!data.id||!data.pix?.copiaECola||data.amount!==order.amount||data.paymentMethod!=='pix')throw Error('invalid_response');
 }catch(error){
  console.error('paguex_create_failed',{code:error?.code||'invalid_response',status:error?.status||502});
  return res.status(502).json({code:'payment_creation_uncertain',error:'Não foi possível confirmar a geração. Confira a cobrança no painel antes de tentar novamente.'});
 }
 let trackingStatus=null;
 if(tracking){try{const result=await sendTracking(tracking.context,data,{customer:order.customer});if(result.sent)trackingStatus=result.status;}catch{console.error('utmify_initial_delivery_failed');}}
 // Analytics failures never hide a successfully created Pix or trigger a second charge.
 return res.status(201).json({copyPaste:data.pix.copiaECola,qrCode:data.pix.qrCodeImageUrl||'',transactionId:data.id,gatewayTransactionId:data.id,orderId:data.id,gateway:'paguex',trackingState:tracking?.token||null,trackingStatus});
}
