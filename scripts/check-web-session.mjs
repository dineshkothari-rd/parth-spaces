import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
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
async function setRules({rules}){const changed=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules}});await changed.cleanup();}
const password='Synthetic-password-123';
async function account(role){
 const email=role+'@example.test';
 const signup=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 const data=await signup.json();assert.ok(data.localId,'synthetic account creation');
 const verified=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({localId:data.localId,emailVerified:true})});assert.equal(verified.status,200);
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'users',data.localId),{name:'Demo '+role,role,accessStatus:'active',...(role==='customer'?{customerId:'demo-tenant'}:{})}));
 return email;
}
const emails={};for(const role of ['admin','staff','customer'])emails[role]=await account(role);
await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,'settings','business'),{name:'Synthetic Spaces',address:'Test address',phone:'9999999999',roomStart:101,roomCount:2,pgCapacity:2,seatPrefix:'A',seatCount:3,defaultPgRent:1000,defaultHotelCharge:100,defaultLibraryFee:500,meterRate:10});await setDoc(doc(db,'tenants','demo-tenant'),{name:'Demo Customer',businessType:'pg',room:'101',status:'checked in',rent:1000});});
const server=spawn('python3',['-m','http.server','5186','--bind','127.0.0.1','--directory',process.env.PARTH_WEB_TEST_DIR],{stdio:'ignore'});
const browser=await chromium.launch({executablePath:process.env.PARTH_BROWSER_EXECUTABLE,headless:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:960}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function login(role){await page.goto('http://127.0.0.1:5186');await page.getByPlaceholder('admin@example.com').fill(emails[role]);await page.getByPlaceholder('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText(/Synthetic Spaces ·/).first()).toBeVisible({timeout:15000});}
 await login('admin');console.log('Admin settings loaded');
 await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
 assert.equal(await page.getByTestId('mobile-navigation').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(tmpdir(),'parth-spaces-dashboard-desktop.png'),fullPage:true});
 for (const width of [960,390]) {
   await page.setViewportSize({width,height:844});
   await expect(page.getByTestId('mobile-navigation')).toBeVisible();
   assert.equal(await page.getByTestId('desktop-sidebar').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.screenshot({path:join(tmpdir(),'parth-spaces-dashboard-mobile.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:join(tmpdir(),'parth-spaces-dashboard-dark.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'light'});
 await page.setViewportSize({width:1440,height:960});
 console.log('Desktop sidebar, tablet/mobile navigation and light/dark responsive layout checked');
 await page.reload();await expect(page.getByText(/Synthetic Spaces ·/).first()).toBeVisible({timeout:15000});console.log('Admin reload persisted');
 await page.getByRole('button',{name:'C Customers',exact:true}).click();await expect(page.getByText('Demo Customer',{exact:false}).first()).toBeVisible();console.log('Customer module click works');
 // Force only this synthetic settings stream to deny access, then restore it.
 await setRules({rules:readFileSync('firestore.rules','utf8').replace("allow read: if settingsId == 'business' && (staff() || customerAccessAllowed());",'allow read: if false;')});
 await page.reload();await expect(page.getByText('Could not load business settings. Please try again.',{exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.getByText('Could not load business settings. Please try again.',{exact:true})).toBeVisible({timeout:15000});
 await setRules({rules:readFileSync('firestore.rules','utf8')});
 await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByText(/Synthetic Spaces ·/).first()).toBeVisible({timeout:15000});console.log('Settings failure and retry recovery work');
 await setRules({rules:readFileSync('firestore.rules','utf8').replace("allow read: if settingsId == 'business' && (staff() || customerAccessAllowed());",'allow read: if false;')});await page.reload();await expect(page.getByText('Could not load business settings. Please try again.',{exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'Logout',exact:true}).click();await expect(page.getByPlaceholder('admin@example.com')).toBeVisible();console.log('Logout from settings failure works');
 await setRules({rules:readFileSync('firestore.rules','utf8')});
 await login('staff');console.log('Staff settings loaded');await context.close();
 const customerContext=await browser.newContext();const customerPage=await customerContext.newPage();customerPage.on('pageerror',e=>errors.push(e.message));await customerPage.goto('http://127.0.0.1:5186');await customerPage.getByPlaceholder('admin@example.com').fill(emails.customer);await customerPage.getByPlaceholder('Password',{exact:true}).fill(password);await customerPage.getByRole('button',{name:'Continue',exact:true}).click();await expect(customerPage.getByText('Demo Customer',{exact:false}).first()).toBeVisible({timeout:15000});console.log('Customer settings and own account loaded');
 assert.deepEqual(errors,[]);console.log('PASS: authenticated role journeys, reload, settings denial/retry and logout, zero page errors. Synthetic demo project only.');
}catch(error){console.log('Browser page errors',errors);throw error;}finally{await browser.close();server.kill('SIGTERM');await env.cleanup();}
