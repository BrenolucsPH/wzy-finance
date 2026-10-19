import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
const resolve=createRequire(import.meta.url).resolve,folder=await mkdtemp(join(tmpdir(),'wzy-interface-'));
const dom=new JSDOM('<!doctype html><html><body><div class="shell dark" style="--bg:#15171b;--text:#edf6f3"><button id="trigger">Abrir</button><div class="view-content"><div class="account-panel" id="root"></div></div></div></body></html>',{url:'https://example.test/'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
// React act is a development-only test utility. This isolated child never changes the production server environment.
process.env.NODE_ENV='development';
const {createElement:h,act}=await import('react'),{createRoot}=await import('react-dom/client');
const root=createRoot(document.getElementById('root'));let scroll=430;Object.defineProperty(window,'scrollY',{get:()=>scroll});window.scrollTo=options=>{scroll=options.top};
function compile(source){let js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const name of ['react','react-dom','react/jsx-runtime','lucide-react','zod']){const url=pathToFileURL(resolve(name)).href;js=js.replaceAll(`from '${name}'`,`from '${url}'`).replaceAll(`from "${name}"`,`from "${url}"`)}return js}
let count=0;const pass=name=>{count++;console.log('PASS',name)};
try{
 const source=await readFile(new URL('../app/ui/modal.tsx',import.meta.url),'utf8'),start=source.indexOf('export function Modal'),end=source.length;
 assert.ok(start>=0&&end>start);const modal="import {useEffect,useRef,useState} from 'react';import {createPortal} from 'react-dom';import {X} from 'lucide-react';\n"+source.slice(start,end);
 await writeFile(join(folder,'components.mjs'),compile(modal));await writeFile(join(folder,'navigation.mjs'),compile(await readFile(new URL('../lib/navigation.ts',import.meta.url),'utf8')));
 let guidance=await readFile(new URL('../app/guidance.tsx',import.meta.url),'utf8');for(const q of ["'",'"'])guidance=guidance.replace(q+'./components'+q,q+'./components.mjs'+q).replace(q+'../lib/navigation'+q,q+'./navigation.mjs'+q);await writeFile(join(folder,'guidance.mjs'),compile(guidance));
 const {Modal}=await import(pathToFileURL(join(folder,'components.mjs')).href),{GettingStarted,SidebarCustomizer}=await import(pathToFileURL(join(folder,'guidance.mjs')).href),{normalizeNavigation}=await import(pathToFileURL(join(folder,'navigation.mjs')).href);
 document.getElementById('trigger').focus();await act(async()=>root.render(h(Modal,{title:'Dispositivos QA',onClose:()=>{}},h('form',null,h('input',{id:'query',defaultValue:'consulta QA'}),h('p',null,'')))));
 assert.equal(document.querySelector('.modal-overlay').parentElement,document.body);assert.equal(document.getElementById('root').querySelector('.modal-overlay'),null);assert.equal(document.body.style.position,'fixed');assert.equal(document.body.style.top,'-430px');document.getElementById('query').focus();
 await act(async()=>root.render(h(Modal,{title:'Dispositivos QA',onClose:()=>{}},h('form',null,h('input',{id:'query',defaultValue:'consulta QA'}),h('p',null,'Dados carregados')))));assert.equal(document.activeElement.id,'query');assert.equal(document.body.style.top,'-430px');await act(async()=>root.render(null));assert.equal(document.body.style.position,'');assert.equal(scroll,430);assert.equal(document.activeElement.id,'trigger');pass('Dialogs live outside animated panels, preserve focus after updates and restore the original page scroll');
 let created;const props={onCreate:kind=>{created=kind},onNavigate:()=>{},onHide:()=>{},onHelp:()=>{}};await act(async()=>root.render(h(GettingStarted,{...props,entries:[]})));assert.equal(document.querySelectorAll('.getting-started-steps li').length,3);const first=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Adicionar primeira conta'));await act(async()=>first.click());assert.equal(created,'account');await act(async()=>root.render(h(GettingStarted,{...props,entries:[{id:'wallet',kind:'account',name:'Carteira',amount:0}]})));assert.equal(document.querySelectorAll('.step-done').length,1);pass('First steps explain financial accounts, open account creation and reflect real completion');
 let saved,closed=false;await act(async()=>root.render(h(SidebarCustomizer,{preferences:normalizeNavigation(null),onSave:async p=>{saved=p},onClose:()=>{closed=true},demo:false})));
 await act(async()=>document.querySelector('[aria-label="Mover Transações para cima"]').click());await act(async()=>document.querySelector('[aria-label="Fixar Transações"]').click());const save=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Salvar meu menu');await act(async()=>save.click());assert.equal(saved.sidebarOrder[0],'Transações');assert.deepEqual(saved.sidebarPinned,['Transações']);assert.equal(closed,true);await act(async()=>root.render(null));pass('Menu can be reordered and pinned with accessible controls and saves the selected preferences');
 console.log(JSON.stringify({passed:count,environment:'Isolated simulated DOM; not a physical browser or phone'}));
}finally{await act(async()=>root.unmount());dom.window.close();await rm(folder,{recursive:true,force:true})}
