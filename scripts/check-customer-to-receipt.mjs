import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (!process.env.PARTH_PLAYWRIGHT_MODULE || !process.env.PARTH_WEB_TEST_DIR) throw new Error('Set PARTH_PLAYWRIGHT_MODULE and PARTH_WEB_TEST_DIR for the isolated browser test.');
const { chromium, expect } = await import(pathToFileURL(process.env.PARTH_PLAYWRIGHT_MODULE).href);
import assert from 'node:assert/strict';
const projectId='demo-parth-spaces';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
const uids={};
const password='Synthetic-password-123';
async function account(role){
 const email=role+'@example.test';
 const signup=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 const data=await signup.json();assert.ok(data.localId,'synthetic account creation');
 const verified=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({localId:data.localId,emailVerified:true})});assert.equal(verified.status,200);
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'users',data.localId),{name:'Demo '+role,role,accessStatus:'active',...(role==='customer'?{customerId:'demo-tenant'}:{})}));
 uids[role]=data.localId; return email;
}
await env.clearFirestore();
const emails={};for(const role of ['admin','staff','customer'])emails[role]=await account(role);
await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,'settings','business'),{name:'Synthetic Spaces',address:'Test address',phone:'9999999999',roomStart:101,roomCount:2,pgCapacity:2,seatPrefix:'A',seatCount:3,defaultPgRent:1000,defaultHotelCharge:100,defaultLibraryFee:500,meterRate:10});await setDoc(doc(db,'tenants','demo-tenant'),{name:'Demo Customer',businessType:'pg',room:'101',status:'checked in',rent:1000});});
const server=spawn('python3',['-m','http.server','5186','--bind','127.0.0.1','--directory',process.env.PARTH_WEB_TEST_DIR],{stdio:'ignore'});
const browser=await chromium.launch({executablePath:process.env.PARTH_BROWSER_EXECUTABLE,headless:true});

const errors=[];let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5186');await page.getByPlaceholder('admin@example.com').fill(emails.admin);await page.getByPlaceholder('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText(/Synthetic Spaces ·/).first()).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'C Customers',exact:true}).click();await page.getByRole('button',{name:'Add customer',exact:true}).click();
 await page.getByText('Next',{exact:true}).click();await page.getByPlaceholder('Full name',{exact:true}).fill('Synthetic Pilot');await page.getByPlaceholder('Phone number',{exact:true}).fill('9999999999');
 await page.getByRole('button',{name:/Room 102/}).click();await page.getByText('Next',{exact:true}).click();
 await page.getByText('PAN Card',{exact:true}).click();await page.getByPlaceholder('Document number',{exact:true}).fill('ABCDE1234F');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=','base64');
 for(let i=0;i<2;i++){
  await page.getByText('Add photo',{exact:true}).first().click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Gallery',exact:true}).click();await (await chooser).setFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await expect(page.getByText('Add photo',{exact:true})).toHaveCount(1-i);
 }
 await page.getByText('Add customer',{exact:true}).last().click();
 await expect(page.getByText('Confirm meter reading',{exact:true})).toBeVisible({timeout:15000});
 const chooser=page.waitForEvent('filechooser');await page.getByText('Choose from gallery',{exact:true}).click();await (await chooser).setFiles({name:'synthetic-meter.png',mimeType:'image/png',buffer:png});
 await expect(page.getByText('Retake photo',{exact:true})).toBeVisible();await page.getByPlaceholder('Enter the number shown on the meter').fill('100');await expect(page.getByPlaceholder('Enter the number shown on the meter')).toHaveValue('100');await page.getByText('Save & check in',{exact:true}).click();
 await expect(page.getByText('Confirm meter reading',{exact:true})).toHaveCount(0,{timeout:15000});console.log('PASS new PG customer, photos, room allocation and meter check-in');
 let customer;
 await env.withSecurityRulesDisabled(async c=>{customer=(await getDocs(collection(c.firestore(),'tenants'))).docs.map(d=>({id:d.id,...d.data()})).find(t=>t.name==='Synthetic Pilot');});assert.equal(customer.status,'checked in');assert.equal(customer.room,'Room 102');
 await page.getByRole('button',{name:'M Finances',exact:true}).click();
 await page.getByText('Add payment',{exact:true}).first().click();
 await page.getByRole('button',{name:/Synthetic Pilot/}).click();await page.getByLabel('Amount paid',{exact:true}).fill('400');await page.getByText('Save payment',{exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Freeze this month’s invoice before recording payment.');console.log('PASS failed save is visible in the open payment form');
 await page.getByText('Close',{exact:true}).click();await page.getByText('Freeze invoices',{exact:true}).click();await page.getByRole('button',{name:'OK',exact:true}).click();
 await page.getByText('Add payment',{exact:true}).first().click();await page.getByRole('button',{name:/Synthetic Pilot/}).click();await page.getByLabel('Amount paid',{exact:true}).fill('400');await page.getByText('Save payment',{exact:true}).click();
 await expect(page.getByText('Close',{exact:true})).toHaveCount(0,{timeout:15000});
 await page.evaluate(()=>{const open=window.open.bind(window);window.open=(...args)=>{const p=open(...args);if(p)p.print=()=>{p.document.body.dataset.printRequested='true'};return p;};});
 const popup=context.waitForEvent('page');await page.getByText('Receipt',{exact:true}).first().click();const receipt=await popup;await receipt.waitForLoadState();
 await expect(receipt.locator('body')).toContainText('Synthetic Pilot');await expect(receipt.locator('body')).toContainText('400');await expect(receipt.locator('body')).toContainText('600');assert.equal(await receipt.evaluate(()=>window.opener),null);await receipt.close();console.log('PASS partial payment and separate receipt with correct balance');
 await page.reload();await expect(page.getByText(/Synthetic Spaces ·/).first()).toBeVisible();await page.getByRole('button',{name:'M Finances',exact:true}).click();await page.getByText('Add payment',{exact:true}).first().click();await page.getByRole('button',{name:/Synthetic Pilot/}).click();await page.getByLabel('Amount paid',{exact:true}).fill('601');await page.getByText('Save payment',{exact:true}).click();await expect(page.getByText(/Amount cannot be more than/)).toBeVisible();
 await page.getByLabel('Amount paid',{exact:true}).fill('600');await page.getByText('Save payment',{exact:true}).click();await expect(page.getByText('Close',{exact:true})).toHaveCount(0,{timeout:15000});
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();const payments=(await getDocs(collection(db,'payments'))).docs.map(d=>d.data()).filter(p=>p.tenantId===customer.id);assert.equal(payments.length,2);assert.equal(payments.reduce((n,p)=>n+p.amountPaid,0),1000);const month=payments[0].month;assert.equal((await getDoc(doc(db,'paymentAccounts',customer.id+'_'+month))).data().paid,1000);assert.equal((await getDoc(doc(db,'invoices',customer.id+'_'+month))).data().total,1000);});
 for(const width of [1440,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}

 await env.withSecurityRulesDisabled(async c=>{
  await updateDoc(doc(c.firestore(),'users',uids.customer),{customerId:customer.id});
  await updateDoc(doc(c.firestore(),'tenants',customer.id),{userId:uids.customer,accessStatus:'active'});
  await updateDoc(doc(c.firestore(),'users',uids.staff),{permissions:{money:false,customers:true,operations:true}});
 });
 const customerContext=await browser.newContext({viewport:{width:390,height:844}});const customerPage=await customerContext.newPage();customerPage.on('pageerror',e=>errors.push(e.message));
 await customerPage.goto('http://127.0.0.1:5186');await customerPage.getByPlaceholder('admin@example.com').fill(emails.customer);await customerPage.getByPlaceholder('Password',{exact:true}).fill(password);await customerPage.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(customerPage.getByText('Receipt',{exact:true})).toHaveCount(2,{timeout:15000});assert.equal(await customerPage.getByText('Demo Customer',{exact:true}).count(),0);assert.ok(await customerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await customerContext.close();
 const staffContext=await browser.newContext();const staffPage=await staffContext.newPage();staffPage.on('pageerror',e=>errors.push(e.message));
 await staffPage.goto('http://127.0.0.1:5186');await staffPage.getByPlaceholder('admin@example.com').fill(emails.staff);await staffPage.getByPlaceholder('Password',{exact:true}).fill(password);await staffPage.getByRole('button',{name:'Continue',exact:true}).click();await expect(staffPage.getByText(/Synthetic Spaces ·/).first()).toBeVisible();assert.equal(await staffPage.getByRole('button',{name:'M Finances',exact:true}).count(),0);await staffContext.close();console.log('PASS own customer receipts and restricted staff navigation');
 assert.deepEqual(errors,[]);console.log('PASS persisted invoice, two recorded payments, full balance, overpayment rejection, desktop/mobile and zero page errors. Demo only.');
}catch(error){console.log('Page errors',errors);if(page)console.log((await page.locator('body').innerText()).slice(-3500));throw error;}finally{await browser.close();server.kill('SIGTERM');await env.cleanup();}
