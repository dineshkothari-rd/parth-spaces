import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails} from '@firebase/rules-unit-testing';
import {collection, doc, getDoc, getDocs, setDoc, updateDoc, runTransaction, type Firestore, serverTimestamp, Timestamp} from 'firebase/firestore';
import {assertCheckoutPayments, recordMonthlyPayment, voidMonthlyPayment, type PaymentDraft} from '../src/features/money/paymentTransactions';

async function main() {
const env=await initializeTestEnvironment({projectId:'demo-parth-spaces',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  for(const id of ['staff-a','staff-b'])await setDoc(doc(db,'users',id),{role:'staff',accessStatus:'active'});
  await setDoc(doc(db,'users','customer-a'),{role:'customer',accessStatus:'active',customerId:'tenant-a'});
  await setDoc(doc(db,'tenants','tenant-a'),{name:'Synthetic Customer',businessType:'pg',status:'checked in',rent:1000});
  await setDoc(doc(db,'invoices','tenant-a_2026-10'),{tenantId:'tenant-a',month:'2026-10',total:1000});
 });
 const staff=(id:string)=>env.authenticatedContext(id,{email_verified:true}).firestore() as unknown as Firestore;
 const a=staff('staff-a'),b=staff('staff-b');
 const draft:PaymentDraft={amountPaid:700,paymentMode:'Cash',reference:'',balance:300,businessType:'pg',month:'2026-10',note:'',paidOn:'2026-10-08',status:'Recorded',tenantId:'tenant-a',tenantName:'Synthetic Customer',tenantRoom:'Room 101',totalRent:1000};
 const concurrent=await Promise.allSettled([recordMonthlyPayment(a,draft,'staff-a'),recordMonthlyPayment(b,draft,'staff-b')]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
 const winner=concurrent.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof recordMonthlyPayment>>>;
 assert.equal((await getDoc(doc(a,'paymentAccounts','tenant-a_2026-10'))).data()?.paid,700);
 const final=await recordMonthlyPayment(a,{...draft,amountPaid:300},'staff-a');assert.equal(final.balance,0);
 const replay=await recordMonthlyPayment(a,{...draft,amountPaid:300},'staff-a',final.id);assert.equal(replay.id,final.id);
 await assert.rejects(recordMonthlyPayment(a,{...draft,amountPaid:301},'staff-a',final.id),/different details/);
 await assert.rejects(recordMonthlyPayment(b,{...draft,amountPaid:1},'staff-b'),/latest remaining balance/);
 await voidMonthlyPayment(a,winner.value.id,'staff-a');
 assert.equal((await getDoc(doc(a,'paymentAccounts','tenant-a_2026-10'))).data()?.paid,300);
 await assert.rejects(voidMonthlyPayment(a,winner.value.id,'staff-a'),/already voided/);
 await recordMonthlyPayment(b,draft,'staff-b');
 await assertFails(setDoc(doc(a,'payments','unlinked'),{...draft,amountPaid:1,balance:999,createdAt:serverTimestamp(),createdBy:'staff-a'}));
 await assertFails(updateDoc(doc(a,'paymentAccounts','tenant-a_2026-10'),{paid:0}));
 await assertFails(getDoc(doc(env.authenticatedContext('customer-a',{email_verified:true}).firestore(),'paymentAccounts','tenant-a_2026-10')));
 await assert.rejects(recordMonthlyPayment(a,{...draft,month:'2026-11'},'staff-a'),/Freeze/);
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();await setDoc(doc(db,'invoices','tenant-a_2026-09'),{tenantId:'tenant-a',month:'2026-09',total:1000});
  await setDoc(doc(db,'payments','legacy'),{tenantId:'tenant-a',month:'2026-09',amountPaid:600,status:'Recorded'});
  await setDoc(doc(db,'payments','legacy-user'),{userId:'tenant-a',month:'2026-09',amountPaid:200,status:'Recorded'});
 });
 const legacy=await recordMonthlyPayment(a,{...draft,month:'2026-09',amountPaid:200},'staff-a');assert.equal(legacy.balance,0);
 await assert.rejects(recordMonthlyPayment(a,{...draft,month:'2026-09',amountPaid:1},'staff-a'),/latest remaining balance/);
 await assert.rejects(runTransaction(a,transaction=>assertCheckoutPayments(transaction,a,'tenant-a',['2026-10'],[])),/Payments changed/);
 await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'settlements','tenant-a'),{tenantId:'tenant-a',status:'Final'}));
 await assert.rejects(recordMonthlyPayment(a,{...draft,amountPaid:1},'staff-a'),/Settlements/);
 await assert.rejects(voidMonthlyPayment(a,final.id,'staff-a'),/Checkout is final/);
 let backup: Record<string, {id:string;data:Record<string,unknown>}[]> = {};
 await env.withSecurityRulesDisabled(async context => {
  const result: Record<string, {id:string;data:unknown}[]> = {};
  for (const name of ['users','tenants','invoices','payments','paymentAccounts','auditEvents','settlements']) result[name] = (await getDocs(collection(context.firestore(),name))).docs.map(item => ({id:item.id,data:item.data()}));
  backup = JSON.parse(JSON.stringify(result),(_key,value)=>value?.type==='firestore/timestamp/1.0'?new Timestamp(value.seconds,value.nanoseconds):value);
 });
 const restored=await initializeTestEnvironment({projectId:'demo-parth-spaces-restore',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
 try{
  await restored.clearFirestore();
  await restored.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   for(const [name,records] of Object.entries(backup))for(const record of records as {id:string;data:Record<string,unknown>}[])await setDoc(doc(db,name,record.id),record.data);
   assert.equal((await getDoc(doc(db,'paymentAccounts','tenant-a_2026-10'))).data()?.paid,1000);
   assert.equal((await getDoc(doc(db,'paymentAccounts','tenant-a_2026-09'))).data()?.paid,1000);
   assert.equal((await getDoc(doc(db,'payments',final.id))).data()?.createdAt instanceof Timestamp,true);
   assert.equal((await getDocs(collection(db,'payments'))).size,backup.payments.length);
  });
 }finally{await restored.cleanup();}
 console.log('PASS: separate demo JSON restore preserves financial counters, original payment IDs and timestamps. Auth credentials are not backed up by this check.');
 console.log('PASS: concurrent payments, full/partial balance, overpayment rejection, void/retry, legacy seeding, frozen invoice, closed checkout and restricted account access. Demo only.');
}finally{await env.cleanup();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
