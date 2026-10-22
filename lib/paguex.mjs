import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
const BASE='https://api.pague-x.com.br/v1';
const CALLBACK='https://luva-lanca-teia.vercel.app/api/public/pix/webhook/';
const digits=value=>String(value||'').replace(/\D/g,'');
export class PaymentError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const invalid=(code,message)=>{throw new PaymentError(code,message);};
export function validCpf(cpf){
 if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
 for(let length=9;length<11;length++){let sum=0;for(let i=0;i<length;i++)sum+=Number(cpf[i])*(length+1-i);if(((sum*10)%11)%10!==Number(cpf[length]))return false;}return true;
}
export function parseOrder(body){
 const product=body?.products?.[0];
 if(body?.products?.length!==1||product?.name!=='LUVA_LANCA_TEIA')invalid('invalid_product','Confira o produto do pedido.');
 const quantity=Number(product.quantity);
 if(!Number.isInteger(quantity)||quantity<1||quantity>20)invalid('invalid_product','Confira a quantidade.');
 const catalog={'mais-uma-luva':1499,'duas-luvas':2499},bumps=body.bumpIds||[];
 if(!Array.isArray(bumps)||bumps.length>2||new Set(bumps).size!==bumps.length||bumps.some(id=>typeof id!=='string'||!Object.hasOwn(catalog,id)))invalid('invalid_product','Confira os adicionais.');
 const shipping={'PAC - FRETE GRÁTIS':0,PAC:0,JADLOG:1847,'SEDEX 12':3340};
 if(typeof body.shippingMethod!=='string'||!Object.hasOwn(shipping,body.shippingMethod))invalid('invalid_shipping','Selecione o frete.');
 const amount=1799*quantity+shipping[body.shippingMethod]+bumps.reduce((sum,id)=>sum+catalog[id],0);
 if(!Number.isFinite(Number(body.amount))||Math.abs(Number(body.amount)*100-amount)>0.00001)invalid('invalid_amount','O total mudou. Confira o pedido.');
 const input=body.client||{},customer={name:String(input.name||'').trim().slice(0,160),email:String(input.email||'').trim().slice(0,254),document:digits(input.document),phone:digits(input.phone)};
 if(!validCpf(customer.document))invalid('invalid_document','Informe um CPF válido.');
 if(customer.name.split(/\s+/).length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||!/^\d{10,11}$/.test(customer.phone))invalid('invalid_payment_data','Confira nome, e-mail e telefone.');
 const inputAddress=body.shipping||{};
 const address={zipcode:digits(inputAddress.cep),street:String(inputAddress.logradouro||'').trim().slice(0,200),number:String(inputAddress.numero||'').trim().slice(0,30),complement:String(inputAddress.complemento||'').trim().slice(0,200),neighborhood:String(inputAddress.bairro||'').trim().slice(0,200),city:String(inputAddress.cidade||'').trim().slice(0,100),state:String(inputAddress.uf||'').trim().toUpperCase(),country:'BR'};
 if(address.zipcode.length!==8||!address.street||!address.number||!address.neighborhood||!address.city||!/^[A-Z]{2}$/.test(address.state))invalid('invalid_shipping','Confira o endereço de entrega.');
 customer.address=address;
 return {amount,customer,description:'Luva Lança-Teia Infantil — '+(quantity+(bumps.includes('mais-uma-luva')?1:0)+(bumps.includes('duas-luvas')?2:0))+' unidade(s); frete '+body.shippingMethod};
}
function sign(value){return createHmac('sha256',process.env.PAGUEX_WEBHOOK_SECRET).update(value).digest('hex');}
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
// Full 256-bit HMAC in base64url fits the provider's observed 80-character limit.
export function makeReference(amount){const value=`lv2.${amount}.${randomBytes(12).toString('hex')}`;return value+'.'+Buffer.from(sign(value),'hex').toString('base64url');}
function referenceBase(reference){
 if(typeof reference!=='string')return null;
 const match=reference.match(/^(lv2\.\d+\.[a-f0-9]{24}\.[A-Za-z0-9_-]{43}|lv1\.\d+\.\d{13}\.[a-f0-9]{24}\.[a-f0-9]{64})(?:_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?$/i);
 return match?match[1]:null;
}
export function validReference(reference,amount){
 const base=referenceBase(reference);
 if(!base||!process.env.PAGUEX_WEBHOOK_SECRET||!Number.isSafeInteger(amount))return false;
 const parts=base.split('.'),signature=parts.pop(),hex=sign(parts.join('.'));
 const expected=parts[0]==='lv2'?Buffer.from(hex,'hex').toString('base64url'):hex;
 return Number(parts[1])===amount&&equal(signature,expected);
}
export function normalizeCharge(input){
 const data=input?.data&&typeof input.data==='object'&&(input.data.id||input.data.saleId)?input.data:input;
 if(!data||typeof data!=='object')return {};
 const amount=typeof data.amount==='number'?data.amount:(typeof data.amount==='string'&&/^\d+$/.test(data.amount)?Number(data.amount):NaN);
 return {...data,id:data.id||data.saleId,amount,paymentMethod:typeof data.paymentMethod==='string'?data.paymentMethod.toLowerCase():data.paymentMethod};
}
export function verifySignature(raw,signature){if(!process.env.PAGUEX_WEBHOOK_SECRET||typeof signature!=='string')return false;return equal(signature,'sha256='+createHmac('sha256',process.env.PAGUEX_WEBHOOK_SECRET).update(raw).digest('hex'));}
export function configured(){return !!(process.env.PAGUEX_SECRET_KEY&&process.env.PAGUEX_WEBHOOK_SECRET);}
export async function api(path,options={}){
 const response=await fetch(BASE+path,{...options,headers:{Authorization:'Bearer '+process.env.PAGUEX_SECRET_KEY,'Content-Type':'application/json',Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new PaymentError('paguex_request_failed','Não foi possível concluir a operação no gateway.',response.status===404?404:502);
 if(!data||typeof data!=='object')throw new PaymentError('paguex_invalid_response','Resposta inválida do gateway.',502);
 return data;
}
export async function createCharge(order){
 const reference=makeReference(order.amount);
 let charge=normalizeCharge(await api('/charges',{method:'POST',body:JSON.stringify({...order,paymentMethod:'pix',currency:'BRL',reference,postbackUrl:CALLBACK})}));
 // Read missing response metadata without repeating the charge-creation POST.
 if(typeof charge.id==='string'&&/^[a-zA-Z0-9._-]{8,200}$/.test(charge.id)&&(!charge.reference||!Number.isSafeInteger(charge.amount)||!charge.paymentMethod)){
  const details=normalizeCharge(await api('/charges/'+encodeURIComponent(charge.id)));
  if(details.id!==charge.id)throw new PaymentError('paguex_invalid_response','Cobrança divergente.',502);
  charge={...charge,...details,pix:charge.pix||details.pix};
 }
 if(referenceBase(charge.reference)!==reference||!validReference(charge.reference,order.amount))throw new PaymentError('paguex_invalid_reference','Referência inválida do gateway.',502);
 return charge;
}
export async function getCharge(id){
 if(!/^[a-zA-Z0-9._-]{8,200}$/.test(id))throw new PaymentError('invalid_transaction','Pagamento inválido.');
 const charge=normalizeCharge(await api('/charges/'+encodeURIComponent(id)));
 if(charge.id!==id||charge.paymentMethod!=='pix'||!validReference(charge.reference,charge.amount))throw new PaymentError('payment_not_found','Pagamento não encontrado.',404);
 return charge;
}
export function handleError(res,error){return res.status(error instanceof PaymentError?error.status:502).json({code:error instanceof PaymentError?error.code:'paguex_unavailable',error:error instanceof PaymentError?error.message:'Não foi possível consultar o pagamento.'});}
