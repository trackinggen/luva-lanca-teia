import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {parseOrder,makeReference} from '../lib/paguex.mjs';
import {prepareTracking,readTracking} from '../lib/utmify.mjs';
import create from '../api/public/pix/create.js';
import webhook from '../api/public/pix/webhook.js';
import getStatus from '../api/public/pix/status.js';
process.env.PAGUEX_SECRET_KEY='test-only-key';process.env.PAGUEX_WEBHOOK_SECRET='test-only-webhook';process.env.UTMIFY_API_TOKEN='test-only-utmify';process.env.UTMIFY_STATE_SECRET='test-only-state-secret';
const body=()=>({amount:17.99,products:[{name:'LUVA_LANCA_TEIA',quantity:1}],shippingMethod:'PAC - FRETE GRÁTIS',bumpIds:[],client:{name:'Pessoa Teste',email:'teste@example.com',document:'11144477735',phone:'11999999999'},shipping:{cep:'01001000',logradouro:'Praça da Sé',numero:'1',bairro:'Sé',cidade:'São Paulo',uf:'SP'},utm:{source:'FB',medium:'adset|123',campaign:'campanha|456',content:'anuncio|789',term:'Facebook_Reels',src:'source-ref',sck:'click-ref'}});
function res(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){return this;}};}
async function mock(fn,run){const original=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=original;}}
function prepared(){const b=body(),order=parseOrder(b),reference=makeReference(order.amount);return {b,order,reference,tracking:prepareTracking(b,order,reference)};}
function reqFor(setup,{status='paid',badSignature=false,amount=1799}={}){const event={event:'sale.'+status,createdAt:new Date().toISOString(),data:{saleId:'charge-123456',reference:setup.reference,amount,paymentMethod:'pix',status,customer:{name:setup.b.client.name,email:setup.b.client.email,phone:setup.b.client.phone,document:setup.b.client.document}}};const raw=Buffer.from(JSON.stringify(event)),req=Readable.from([raw]);req.method='POST';req.query={state:setup.tracking.token};req.headers={'x-paguex-signature':badSignature?'bad':'sha256='+createHmac('sha256',process.env.PAGUEX_WEBHOOK_SECRET).update(raw).digest('hex')};return req;}
function charge(setup,status='paid'){return {id:'charge-123456',reference:setup.reference,amount:1799,paymentMethod:'pix',status,createdAt:new Date().toISOString(),customer:{name:setup.b.client.name,email:setup.b.client.email,phone:setup.b.client.phone}};}
test('encrypted callback preserves UTMs without a database or personal data',()=>{
 const s=prepared(),context=readTracking(s.tracking.token);assert.equal(context.trackingParameters.utm_source,'FB');assert.equal(context.trackingParameters.utm_campaign,'campanha|456');assert.equal(context.products[0].priceInCents,1799);assert.equal(context.customer,undefined);assert.equal(context.document,undefined);assert.equal(context.amount,1799);assert.ok(s.tracking.callbackUrl.length<2048);assert.ok(!s.tracking.token.includes('campanha'));assert.ok(!JSON.stringify(context).includes(s.b.client.email));
});
test('tampered, expired and oversized contexts are rejected',()=>{
 const s=prepared();const token=s.tracking.token;assert.throws(()=>readTracking(token.slice(0,-8)+'AAAAAAAA'));assert.throws(()=>readTracking('x'.repeat(1900)));
 const original=Date.now;Date.now=()=>original()+31*864e5;try{assert.throws(()=>readTracking(token));}finally{Date.now=original;}
});
test('creation sends one pending order and keeps personal data out of callback URL',async()=>{
 let posts=0;const deliveries=[];
 await mock(async(url,options)=>{
  if(url==='https://pay.pague-x.com.br/v1/charges'){posts++;const p=JSON.parse(options.body);assert.equal(p.items,undefined);const state=new URL(p.postbackUrl).searchParams.get('state');assert.equal(readTracking(state).reference,p.reference);return Response.json({id:'charge-123456',reference:p.reference,amount:1799,paymentMethod:'pix',status:'pending',pix:{copiaECola:'000201-valid'}});}
  assert.equal(url,'https://api.utmify.com.br/api-credentials/orders');assert.equal(options.headers['x-api-token'],'test-only-utmify');deliveries.push(JSON.parse(options.body));return Response.json({OK:true});
 },async()=>{const r=res();await create({method:'POST',body:body()},r);assert.equal(r.statusCode,201);assert.equal(r.body.trackingStatus,'waiting_payment');assert.ok(r.body.trackingState);assert.equal(posts,1);assert.equal(deliveries.length,1);assert.equal(deliveries[0].orderId,'charge-123456');assert.equal(deliveries[0].status,'waiting_payment');assert.equal(deliveries[0].approvedDate,null);assert.equal(deliveries[0].customer.document,null);assert.equal(deliveries[0].commission.totalPriceInCents,1799);});
});
test('signed paid webhook confirms gateway state then updates the same order and UTMs',async()=>{
 const s=prepared(),orders=[];let reads=0;
 await mock(async(url,options)=>{if(url.startsWith('https://pay.pague-x.com.br/')){reads++;return Response.json(charge(s));}orders.push(JSON.parse(options.body));return Response.json({OK:true});},async()=>{
  for(let i=0;i<2;i++){const r=res();await webhook(reqFor(s),r);assert.equal(r.statusCode,200);assert.equal(r.body.tracking,'paid');}
 });
 assert.equal(reads,2);assert.equal(orders.length,2);assert.equal(orders[0].orderId,orders[1].orderId);assert.equal(orders[0].orderId,'charge-123456');assert.equal(orders[0].status,'paid');assert.equal(orders[0].trackingParameters.utm_campaign,'campanha|456');assert.equal(orders[0].customer.document,null);assert.ok(orders[0].approvedDate);
});
test('unsigned callback cannot send anything to UTMify',async()=>{
 const s=prepared();let calls=0;await mock(async()=>{calls++;throw Error();},async()=>{const r=res();await webhook(reqFor(s,{badSignature:true}),r);assert.equal(r.statusCode,401);});assert.equal(calls,0);
});
test('pending gateway state never becomes paid because of a paid callback',async()=>{
 const s=prepared(),orders=[];await mock(async(url,options)=>{if(url.startsWith('https://pay.pague-x.com.br/'))return Response.json(charge(s,'pending'));orders.push(JSON.parse(options.body));return Response.json({OK:true});},async()=>{const r=res();await webhook(reqFor(s),r);assert.equal(r.statusCode,200);});assert.equal(orders[0].status,'waiting_payment');assert.equal(orders[0].approvedDate,null);
});
test('tracking failure never hides a successfully created Pix or repeats creation',async()=>{
 let posts=0;await mock(async(url,options)=>{if(url==='https://pay.pague-x.com.br/v1/charges'){posts++;const p=JSON.parse(options.body);return Response.json({id:'charge-123456',reference:p.reference,amount:1799,paymentMethod:'pix',status:'pending',pix:{copiaECola:'000201-valid'}});}return Response.json({OK:false},{status:503});},async()=>{const r=res();await create({method:'POST',body:body()},r);assert.equal(r.statusCode,201);assert.equal(r.body.copyPaste,'000201-valid');assert.equal(r.body.trackingStatus,null);assert.equal(posts,1);});
});
test('failed delivery is not acknowledged as successful and retry uses the same order ID',async()=>{
 const s=prepared(),ids=[];let fail=true;await mock(async(url,options)=>{if(url.startsWith('https://pay.pague-x.com.br/'))return Response.json(charge(s));ids.push(JSON.parse(options.body).orderId);return Response.json({OK:!fail},{status:fail?503:200});},async()=>{let r=res();await webhook(reqFor(s),r);assert.equal(r.statusCode,502);fail=false;r=res();await webhook(reqFor(s),r);assert.equal(r.statusCode,200);});assert.deepEqual(ids,['charge-123456','charge-123456']);
});
test('another payment cannot reuse an encrypted context',async()=>{
 const s=prepared();let calls=0;await mock(async()=>{calls++;return Response.json({...charge(s),reference:makeReference(1799)});},async()=>{const r=res();await webhook(reqFor(s),r);assert.equal(r.statusCode,502);});assert.equal(calls,1);
});
test('context too large fails before creating a charge',async()=>{
 const b=body();for(const name of ['source','campaign','medium','content','term','src','sck'])b.utm[name]=randomBytes(1600).toString('base64');let calls=0;
 await mock(async()=>{calls++;throw Error();},async()=>{const r=res();await create({method:'POST',body:b},r);assert.equal(r.statusCode,400);assert.equal(r.body.code,'invalid_tracking_context');});assert.equal(calls,0);
});

test('status polling can recover a paid delivery with the original campaign',async()=>{
 const s=prepared(),orders=[];await mock(async(url,options)=>{if(url.startsWith('https://pay.pague-x.com.br/'))return Response.json(charge(s));orders.push(JSON.parse(options.body));return Response.json({OK:true});},async()=>{const r=res();await getStatus({method:'GET',query:{id:'charge-123456',state:s.tracking.token,tracked:'waiting_payment'}},r);assert.equal(r.statusCode,200);assert.equal(r.body.status,'paid');assert.equal(r.body.trackingStatus,'paid');assert.equal(r.body.customer,undefined);});assert.equal(orders.length,1);assert.equal(orders[0].trackingParameters.utm_campaign,'campanha|456');
});
test('browser can avoid repeated tracking once its current status was sent',async()=>{
 const s=prepared();let sends=0;await mock(async(url)=>{if(url.startsWith('https://pay.pague-x.com.br/'))return Response.json(charge(s));sends++;return Response.json({OK:true});},async()=>{const r=res();await getStatus({method:'GET',query:{id:'charge-123456',state:s.tracking.token,tracked:'paid'}},r);assert.equal(r.body.status,'paid');assert.equal(r.body.trackingStatus,'paid');});assert.equal(sends,0);
});
test('Utmify outage does not change the confirmed payment status',async()=>{
 const s=prepared();await mock(async(url)=>url.startsWith('https://pay.pague-x.com.br/')?Response.json(charge(s)):Response.json({OK:false},{status:503}),async()=>{const r=res();await getStatus({method:'GET',query:{id:'charge-123456',state:s.tracking.token}},r);assert.equal(r.statusCode,200);assert.equal(r.body.status,'paid');assert.equal(r.body.trackingStatus,null);});
});
