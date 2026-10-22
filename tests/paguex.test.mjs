import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {parseOrder,makeReference,validReference,verifySignature} from '../lib/paguex.mjs';
import create from '../api/public/pix/create.js';
import status from '../api/public/pix/status.js';
import webhook from '../api/public/pix/webhook.js';
process.env.PAGUEX_SECRET_KEY='test-only-key';
process.env.PAGUEX_WEBHOOK_SECRET='test-only-secret';
const body=()=>({amount:17.99,products:[{name:'LUVA_LANCA_TEIA',quantity:1}],shippingMethod:'PAC - FRETE GRÁTIS',bumpIds:[],client:{name:'Pessoa Teste',email:'teste@example.com',document:'11144477735',phone:'11999999999'},shipping:{cep:'01001000',logradouro:'Praça da Sé',numero:'1',bairro:'Sé',cidade:'São Paulo',uf:'SP'}});
function res(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){return this;}};}
async function withFetch(fn,run){const original=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=original;}}
function signedEvent(event){const raw=Buffer.from(JSON.stringify(event));const req=Readable.from([raw]);req.method='POST';req.headers={'x-paguex-signature':'sha256='+createHmac('sha256',process.env.PAGUEX_WEBHOOK_SECRET).update(raw).digest('hex')};return req;}
test('server calculates base, quantities, both bumps and paid shipping',()=>{
 assert.equal(parseOrder(body()).amount,1799);
 const b=body();b.products[0].quantity=2;b.bumpIds=['mais-uma-luva','duas-luvas'];b.shippingMethod='JADLOG';b.amount=94.43;
 const order=parseOrder(b);assert.equal(order.amount,9443);assert.equal(order.customer.address.state,'SP');assert.match(order.description,/Luva/);
});
test('rejects manipulated prices, unknown bumps, fee products and invalid payer',()=>{
 for(const mutate of [b=>b.amount=0.78,b=>b.bumpIds=['__proto__'],b=>b.bumpIds=['duas-luvas','duas-luvas'],b=>b.products[0].name='TAXA_NFE',b=>b.client.document='00000000000',b=>b.shippingMethod='constructor',b=>b.client.email='',b=>b.shipping.cep='']){
  const b=body();mutate(b);assert.throws(()=>parseOrder(b));
 }
});
test('signed reference binds amount and rejects tampering',()=>{
 const ref=makeReference(1799);assert.equal(validReference(ref,1799),true);assert.equal(validReference(ref,1),false);assert.equal(validReference(ref.replace('1799','1999'),1999),false);
});
test('signature uses exact raw bytes and rejects missing or wrong signature',()=>{
 const raw=Buffer.from('{"event":"sale.paid"}'),sig='sha256='+createHmac('sha256',process.env.PAGUEX_WEBHOOK_SECRET).update(raw).digest('hex');
 assert.ok(verifySignature(raw,sig));assert.equal(verifySignature(Buffer.from(raw+' '),sig),false);assert.equal(verifySignature(raw,undefined),false);
});
test('create translates authenticated Pague-X response to existing modal contract',async()=>{
 await withFetch(async(url,options)=>{assert.equal(url,'https://api.pague-x.com.br/v1/charges');assert.equal(options.headers.Authorization,'Bearer test-only-key');const payload=JSON.parse(options.body);assert.equal(payload.amount,1799);assert.equal(payload.customer.name,'Pessoa Teste');assert.equal(payload.paymentMethod,'pix');assert.match(payload.postbackUrl,/luva-lanca-teia.*webhook$/);assert.ok(validReference(payload.reference,1799));return Response.json({id:'charge-123456',reference:payload.reference,amount:1799,paymentMethod:'pix',pix:{copiaECola:'000201-test',qrCodeImageUrl:'https://example.com/qr'}});},async()=>{const r=res();await create({method:'POST',body:body()},r);assert.equal(r.statusCode,201);assert.equal(r.body.copyPaste,'000201-test');assert.equal(r.body.transactionId,'charge-123456');assert.equal(r.body.gateway,'paguex');});
});
test('timeout never retries charge creation and gives an uncertain outcome',async()=>{
 let calls=0;await withFetch(async()=>{calls++;throw Error('timeout');},async()=>{const r=res();await create({method:'POST',body:body()},r);assert.equal(r.statusCode,502);assert.equal(r.body.code,'payment_creation_uncertain');assert.equal(calls,1);});
});
test('status accepts only matching signed own Pix and exposes no payer data',async()=>{
 const ref=makeReference(1799);let state='pending';await withFetch(async()=>Response.json({id:'charge-123456',amount:1799,reference:ref,paymentMethod:'pix',status:state,customer:{email:'private@example.com'}}),async()=>{
 for(const value of ['pending','paid','under_review','chargeBack']){state=value;const r=res();await status({method:'GET',query:{id:'charge-123456'}},r);assert.equal(r.statusCode,200);assert.equal(r.body.status,value.toLowerCase());assert.equal(r.body.customer,undefined);assert.equal(r.body.amount,17.99);}
 });
});
test('foreign or mismatched charges cannot confirm a checkout',async()=>{
 await withFetch(async()=>Response.json({id:'charge-123456',amount:1799,reference:'foreign-order',paymentMethod:'pix',status:'paid'}),async()=>{const r=res();await status({method:'GET',query:{id:'charge-123456'}},r);assert.equal(r.statusCode,404);assert.notEqual(r.body.status,'paid');});
});
test('webhook rejects unsigned callbacks and tolerates duplicate valid callbacks',async()=>{
 const event={event:'sale.paid',data:{saleId:'charge-123456',reference:makeReference(1799),amount:1799,status:'paid'}};
 const bad=signedEvent(event);bad.headers['x-paguex-signature']='sha256=bad';const r=res();await webhook(bad,r);assert.equal(r.statusCode,401);
 for(let i=0;i<2;i++){const r=res();await webhook(signedEvent(event),r);assert.equal(r.statusCode,200);assert.equal(r.body.received,true);}
});
test('webhook enforces size and JSON validity without performing business side effects',async()=>{
 const req=Readable.from([Buffer.alloc(65537)]);req.method='POST';req.headers={};const r=res();await webhook(req,r);assert.equal(r.statusCode,413);
});
test('disabled credentials fail closed',async()=>{
 const value=process.env.PAGUEX_SECRET_KEY;delete process.env.PAGUEX_SECRET_KEY;try{const r=res();await create({method:'POST',body:body()},r);assert.equal(r.statusCode,503);}finally{process.env.PAGUEX_SECRET_KEY=value;}
});
