import {configured,verifySignature,validReference} from '../../../lib/paguex.mjs';
// HMAC must use the exact raw bytes received, never reserialized JSON.
export const config={api:{bodyParser:false}};
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
 if(!validReference(event.data.reference,event.data.amount))return res.status(200).json({received:true,ignored:true});
 // Pague-X stores payment status. Browser polling always queries that authoritative API.
 // No fulfillment/analytics side effects: duplicate callbacks are harmless.
 return res.status(200).json({received:true});
}
